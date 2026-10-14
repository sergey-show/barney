import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ProviderManifest, VerifyRequest, VerifyResult } from "../../application/spi/providerTypes.ts";
import { wrapSandboxed } from "../sandbox/OsSandbox.ts";

/**
 * Runs a provider's shell verify script under OS sandbox.
 * Exit 0 = ok; stdout/stderr become detail (clipped).
 */
export async function runShellVerify(
  providerDir: string,
  manifest: ProviderManifest,
  req: VerifyRequest,
): Promise<VerifyResult> {
  if (manifest.invoke.kind !== "shell") {
    return {
      ok: false,
      detail: `invoke kind ${manifest.invoke.kind} not supported by ShellVerifyAdapter`,
      provider: manifest.name,
      status: manifest.status,
    };
  }
  const scriptRel = manifest.invoke.command.replace(/^\.\//, "");
  const scriptAbs = join(providerDir, scriptRel);
  if (!existsSync(scriptAbs)) {
    return {
      ok: false,
      detail: `missing script ${scriptRel}`,
      provider: manifest.name,
      status: manifest.status,
    };
  }
  try {
    chmodSync(scriptAbs, 0o755);
  } catch {
    /* best-effort executable bit */
  }
  const timeoutSec = Math.max(5, Math.min(120, manifest.invoke.timeoutSec ?? 30));
  const wrapped = wrapSandboxed({
    cwd: req.worktree,
    command: "/bin/sh",
    args: [scriptAbs],
    env: {
      BARNEY_SPI_PROVIDER: manifest.name,
      BARNEY_SPI_PORT: manifest.port,
      BARNEY_SPI_GOAL: req.goal.slice(0, 2000),
      BARNEY_SPI_WORKTREE: req.worktree,
    },
  });
  const proc = Bun.spawn([wrapped.command, ...wrapped.args], {
    cwd: req.worktree,
    env: {
      ...process.env,
      BARNEY_SPI_PROVIDER: manifest.name,
      BARNEY_SPI_PORT: manifest.port,
      BARNEY_SPI_GOAL: req.goal.slice(0, 2000),
      BARNEY_SPI_WORKTREE: req.worktree,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), timeoutSec * 1000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const detail = clip(`${stdout}\n${stderr}`.trim() || `exit ${code}`);
    return {
      ok: code === 0,
      detail,
      provider: manifest.name,
      status: manifest.status,
    };
  } finally {
    clearTimeout(timer);
  }
}

function clip(text: string, n = 800): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, n - 1)}…`;
}
