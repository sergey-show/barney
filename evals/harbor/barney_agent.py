"""Harbor installed-agent adapter for Barney.

Not part of the kernel. Same shape as Harbor's OpenCode adapter:

- OpenCode: ``npm i -g opencode-ai`` then
  ``opencode --model=provider/model run --format=json --dangerously-skip-permissions -- <instruction>``
- Barney: upload this repo into the task container, install bun, then
  ``bun /opt/barney/evals/harbor/run.ts --model provider/model -- <instruction>``

OpenCode already works in the task cwd. Barney's product CLI creates a
worktree under ``~/.barney``; the eval runner (``run.ts``) pins the worktree
to ``cwd`` so the Terminal-Bench verifier sees the files.

Run::

    harbor run -p /path/to/terminal-bench-2-1/tasks \\
      --agent evals.harbor.barney_agent:Barney \\
      --model ollama/Qwen3.6-35B-A3B-Hermes-V6 \\
      --include-task-name openssl-selfsigned-cert
"""

from __future__ import annotations

import json
import shlex
import ssl
import tarfile
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trajectories import (
    Agent,
    FinalMetrics,
    Observation,
    ObservationResult,
    Step,
    ToolCall,
    Trajectory,
)
from harbor.utils.trajectory_utils import format_trajectory_json

from evals.harbor.settings import apply_environ, get_settings

REPO_ROOT = Path(__file__).resolve().parents[2]
_OUTPUT = "barney.txt"
_PACK = ("src", "evals", "package.json", "bun.lock", "tsconfig.json")
_SKIP_DIR = {".git", "node_modules", "apps", "dist"}


class Barney(BaseInstalledAgent):
    """Installed-agent wrapper. Kernel stays untouched."""

    SUPPORTS_ATIF = True
    _OUTPUT_FILENAME = _OUTPUT

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._instruction: str | None = None

    @staticmethod
    def name() -> str:
        return "barney"

    def version(self) -> str | None:
        return "0.1.0"

    def get_version_command(self) -> str | None:
        return 'export PATH="$HOME/.bun/bin:$PATH"; bun --version'

    async def install(self, environment: BaseEnvironment) -> None:
        settings = get_settings()
        await self.ensure_system_dependencies(environment, ("curl", "bash", "unzip", "ca_certificates", "git"))
        archive = _pack_kernel()
        bun_zip = _ensure_download(settings.bun_linux_zip, settings.bun_linux_url)
        uv_tar = _ensure_download(settings.uv_linux_tar, settings.uv_linux_url)
        try:
            await environment.upload_file(archive, "/tmp/barney-src.tar")
            await environment.upload_file(bun_zip, "/tmp/bun-linux-x64.zip")
            await environment.upload_file(uv_tar, "/tmp/uv-linux.tar.gz")
        finally:
            archive.unlink(missing_ok=True)
        await self.exec_as_root(
            environment,
            command=(
                "set -euo pipefail; "
                "rm -rf /opt/barney; mkdir -p /opt/barney; "
                "tar -xf /tmp/barney-src.tar -C /opt/barney; "
                "chmod -R a+rX /opt/barney; "
                "mkdir -p /tmp/uv-unpack /root/.local/bin; "
                "tar -xzf /tmp/uv-linux.tar.gz -C /tmp/uv-unpack; "
                "UV_BIN=$(find /tmp/uv-unpack -type f -name uv | grep -v uvx | head -1); "
                "UVX_BIN=$(find /tmp/uv-unpack -type f -name uvx | head -1); "
                "install -m 0755 \"$UV_BIN\" /usr/local/bin/uv; "
                "install -m 0755 \"$UVX_BIN\" /usr/local/bin/uvx; "
                "install -m 0755 \"$UV_BIN\" /root/.local/bin/uv; "
                "install -m 0755 \"$UVX_BIN\" /root/.local/bin/uvx; "
                "printf '%s\\n' 'export PATH=\"$HOME/.local/bin:/usr/local/bin:$PATH\"' > /root/.local/bin/env"
            ),
        )
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                "mkdir -p \"$HOME/.bun/bin\" \"$HOME/.local/bin\"; "
                "unzip -o /tmp/bun-linux-x64.zip -d /tmp/bun-unpack; "
                "install -m 0755 /tmp/bun-unpack/bun-linux-x64/bun \"$HOME/.bun/bin/bun\"; "
                "install -m 0755 /usr/local/bin/uv \"$HOME/.local/bin/uv\"; "
                "install -m 0755 /usr/local/bin/uvx \"$HOME/.local/bin/uvx\"; "
                "printf '%s\\n' 'export PATH=\"$HOME/.local/bin:/usr/local/bin:$PATH\"' > \"$HOME/.local/bin/env\"; "
                "export PATH=\"$HOME/.bun/bin:$PATH\"; "
                "export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1; "
                "cd /opt/barney && bun install --frozen-lockfile"
            ),
        )

    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        self._instruction = instruction
        if not self.model_name or "/" not in self.model_name:
            raise ValueError("model must be provider/model, same as OpenCode (e.g. openai/gpt-4.1)")

        env = _model_env(self)
        env["BARNEY_HOME"] = "/tmp/barney-home"
        env["BARNEY_MODEL"] = self.model_name
        env["BARNEY_AUTO_APPROVE_OUTSIDE"] = "1"
        env["PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD"] = "1"
        quoted = shlex.quote(instruction)
        log = f"/logs/agent/{self._OUTPUT_FILENAME}"
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                "export PATH=\"$HOME/.bun/bin:$PATH\"; "
                "mkdir -p /logs/agent /tmp/barney-home; "
                f"bun /opt/barney/evals/harbor/run.ts --model {shlex.quote(self.model_name)} -- {quoted} "
                f"2>&1 | tee {shlex.quote(log)}"
            ),
            env=env,
        )

    def populate_context_post_run(self, context: AgentContext) -> None:
        events = _parse_jsonl(self.logs_dir / self._OUTPUT_FILENAME)
        if not events:
            return
        try:
            trajectory = _to_trajectory(events, self.model_name, self._instruction)
        except Exception:
            self.logger.exception("failed to convert barney jsonl to trajectory")
            return
        if not trajectory:
            return
        path = self.logs_dir / "trajectory.json"
        try:
            path.write_text(format_trajectory_json(trajectory.to_json_dict()))
        except OSError as exc:
            self.logger.debug("could not write %s: %s", path, exc)
        if trajectory.final_metrics:
            fm = trajectory.final_metrics
            context.cost_usd = fm.total_cost_usd
            context.n_input_tokens = fm.total_prompt_tokens or 0
            context.n_output_tokens = fm.total_completion_tokens or 0


def _ensure_download(dest: Path, url: str) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1_000_000:
        return dest
    try:
        import certifi

        context = ssl.create_default_context(cafile=certifi.where())
    except Exception:
        context = ssl.create_default_context()
    with urllib.request.urlopen(url, timeout=120, context=context) as response:
        dest.write_bytes(response.read())
    return dest


def _pack_kernel() -> Path:
    dest = Path(tempfile.mkdtemp()) / "barney-src.tar"
    with tarfile.open(dest, "w") as tar:
        for name in _PACK:
            path = REPO_ROOT / name
            if path.is_file():
                tar.add(path, arcname=name)
                continue
            if not path.is_dir():
                continue
            for file in path.rglob("*"):
                if not file.is_file():
                    continue
                rel = file.relative_to(REPO_ROOT)
                if any(part in _SKIP_DIR for part in rel.parts):
                    continue
                if file.suffix in {".sqlite", ".tgz"}:
                    continue
                tar.add(file, arcname=str(rel))
    return dest


def _model_env(agent: Barney) -> dict[str, str]:
    settings = apply_environ()
    env: dict[str, str] = {}
    connection = getattr(agent, "model_connection", None)
    if connection is not None:
        raw = getattr(connection, "env", None)
        if isinstance(raw, dict):
            env.update({str(k): str(v) for k, v in raw.items() if v is not None})
    for key, value in (
        ("OPENAI_API_KEY", settings.openai_api_key),
        ("OPENAI_BASE_URL", settings.openai_base_url),
        ("ANTHROPIC_API_KEY", settings.anthropic_api_key),
        ("ANTHROPIC_BASE_URL", settings.anthropic_base_url),
        ("OPENROUTER_API_KEY", settings.openrouter_api_key),
        ("OPENROUTER_BASE_URL", settings.openrouter_base_url),
        ("BARNEY_API_KEY", settings.barney_api_key or settings.openai_api_key),
        ("BARNEY_API_BASE", settings.barney_api_base or settings.eval_llm_base),
    ):
        if value:
            env.setdefault(key, str(value))
    env["OPENAI_BASE_URL"] = env.get("BARNEY_API_BASE") or env.get("OPENAI_BASE_URL") or settings.eval_llm_base
    return env


def _parse_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def _to_trajectory(
    events: list[dict[str, Any]],
    model_name: str | None,
    instruction: str | None,
) -> Trajectory | None:
    steps: list[Step] = []
    done: dict[str, Any] = {}
    step_id = 1
    if instruction:
        steps.append(Step(step_id=step_id, source="user", message=instruction))
        step_id += 1
    for event in events:
        etype = event.get("type")
        if etype == "done":
            done = event
            continue
        if etype != "event":
            continue
        kind = str(event.get("kind") or "")
        text = str(event.get("text") or "")
        timestamp = _iso(event.get("at"))
        if kind == "console":
            tool = text.split()[0] if text.split() else "shell"
            call_id = f"call_{step_id}"
            steps.append(
                Step(
                    step_id=step_id,
                    timestamp=timestamp,
                    source="agent",
                    message="",
                    model_name=model_name,
                    tool_calls=[ToolCall(tool_call_id=call_id, function_name=tool, arguments={})],
                    observation=Observation(results=[ObservationResult(source_call_id=call_id, content=text[:8000])]),
                )
            )
        elif kind in {"assistant", "review", "system"}:
            steps.append(
                Step(
                    step_id=step_id,
                    timestamp=timestamp,
                    source="agent",
                    message=text,
                    model_name=model_name,
                )
            )
        elif kind == "thinking":
            steps.append(
                Step(
                    step_id=step_id,
                    timestamp=timestamp,
                    source="agent",
                    message="",
                    model_name=model_name,
                    reasoning_content=text,
                )
            )
        else:
            continue
        step_id += 1
    if len(steps) <= 1 and not done:
        return None
    for index, step in enumerate(steps, start=1):
        step.step_id = index
    tokens = int(done.get("tokens") or 0)
    usd = float(done.get("usd") or 0)
    return Trajectory(
        schema_version="ATIF-v1.7",
        session_id="barney-eval",
        agent=Agent(name="barney", version="0.1.0", model_name=model_name),
        steps=steps,
        final_metrics=FinalMetrics(
            total_prompt_tokens=tokens or None,
            total_cost_usd=usd or None,
            total_steps=len(steps),
        ),
    )


def _iso(value: object) -> str | None:
    if not value:
        return None
    if isinstance(value, str):
        return value
    try:
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None
