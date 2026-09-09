<p align="center">
  <img src="assets/images/barney.jpg" alt="Barney" width="100%">
</p>

## Barney Agent

**English** · [Русский](README.ru.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/sergey-show/barney?style=flat&logo=github)](https://github.com/sergey-show/barney/stargazers)

A self-developing agent.

This is an experimental agent project. Its core idea comes from Carl Jung — the [Self](https://en.wikipedia.org/wiki/Self_in_Jungian_psychology).

![Self diagram](assets/images/image.jpg)

The name **Barney** is in memory of my dog.

The agent learns from its own experience — tasks that worked and tasks that failed.

It remembers that experience, can reuse it, and can draw connections.

It runs as a CLI or a WEB portal.

## Why this shape

![Агент](assets/images/visual_agent.jpg)

Almost all “self-learning” is still mechanistic. The agent is given a hard role in advance (“who you are”). If a task fails, it rewrites its own code or a dynamic skill and spins that loop. That agent does not learn in the human sense. It does not understand why it failed — it retunes itself in the hope that a new configuration will work. A person who makes a mistake does not perform a lobotomy.

Barney is built the other way around. Existence precedes essence: an act first, then a line in the Self. The kernel keeps one turn shape — plan, tool, observe, review — and will not let the current task rewrite that shape. Around the kernel a new body grows: skills that already exist, a tool of its own if none fits, recorded failures (Shadow), recorded paths that worked (light).

Review looks at whether the **requested result** happened, not how confident the prose sounded. Persistence (wanting) is not the same as satisfaction (liking).

The agent also follows four layers of harness around the model.

| | |
|---|---|
| **Constrain** | Sandbox, budget, the same call blocked. Physically impossible, not “strictly forbidden”. |
| **Inform** | Turn law, session facts, lessons, Self. Code assembles what the model sees this step. |
| **Verify** | Review looks at the result (file, run, secret, URL), not at confident prose. |
| **Correct** | Change tool family, record a lesson. Do not hammer the same call. |

## Kernel and body

![Sheme](assets/images/architecture.jpg)

| Stays in `src/` | Lives in `~/.barney` |
|---|---|
| Turn loop, review, budgets, sandbox | Skills, plugins, MCP |
| Immune constitution | Self (compass, character, light, shadow) |
| Tool protocol | Notes, episodes, body git |

## Map

These names describe the runtime. They are not a hard role pasted into a system prompt.

| | In the runtime |
|---|---|
| **Self** | Character in action. Grows from deeds. Cannot be replaced wholesale. |
| **Ego** | This turn: plan, tools, observe, review. Center of the step, not of the whole. |
| **Persona** | The visible reply. A mask, not the center. |
| **Shadow** | Recorded failures. They are not overwritten until they are worked through. |
| **Motive / action / operation** | Why this session exists / what this step is / which tool runs. |
| **Wanting ≠ liking** | Keep going by changing path, not by hammering the same call. |
| **Dream** | Idle time compresses raw Shadow into a few heuristics. |
| **Frustration** | Enough failed paths → stop and ask for a paradigm shift, naming the stuck Shadow. |
| **Shadow recall** | Similar past fails surface before the act (embeddings when the host supports them). |
| **Verified skill** | A skill is pinned only after a recovery that worked — not invented mid-miss. |
| **Analyze then plan** | Same model: what must be true, then the steps, then the act and review. |

## Install

The body always lives in `~/.barney`. The kernel can be installed three ways.

### npm

Needs [Bun](https://bun.sh) ≥ 1.4.

```bash
bun add -g @encsch/barney
barney web
```

Or `npm install -g @encsch/barney` — `bun` still has to be on `PATH` (the launcher uses it).

### GitHub release

Download the file for your platform from 
[Releases](https://github.com/sergey-show/barney/releases/latest):

| File | Platform |
|---|---|
| `barney-darwin-arm64` | macOS Apple Silicon |
| `barney-darwin-x64` | macOS Intel |
| `barney-linux-x64` | Linux x64 |
| `barney-linux-arm64` | Linux ARM64 |
| `barney-windows-x64.exe` | Windows x64 |

```bash
curl -L -o barney https://github.com/sergey-show/barney/releases/latest/download/barney-darwin-arm64
chmod +x barney
./barney web
```

### From source

Needs [Bun](https://bun.sh) ≥ 1.4.

```bash
git clone https://github.com/sergey-show/barney.git
cd barney
bun install
bun run build:web
bun run web            # portal → http://127.0.0.1:7331
bun run cli
bun bin/barney run "task"
```

Your own binary: `bun run build:bin` → `./dist/barney`.

## First run

Bind a model. Cloud keys are picked up on boot:

```bash
export ANTHROPIC_API_KEY=...     # or OPENAI_API_KEY, GROQ_API_KEY
barney providers add --name local --host http://127.0.0.1:11434/v1 --use
barney providers use local --model <id-from-/v1/models>
```

On first boot the instance is not designed yet. Setup is by points, or shortly **`canon`**. After design, essence is written by deeds.

## Commands

| | |
|---|---|
| `barney web` | web-ui (`--port 7331`, `--host 127.0.0.1`) |
| `barney acp` | ACP v1 agent over stdio |
| `barney cli` | Interactive session |
| `barney run "<goal>"` | One shot |
| `barney providers ls` | LLM providers |
| `barney providers add --name … --host …` | add an OpenAI-compatible endpoint |
| `barney providers use <id> --model …` | Bind the model (plan, act, review) |
| `barney agents ls` | Instances |

The interactive CLI has the same session boundary as Web. Use `/help` inside it;
key flows include `/new`, `/sessions [query]`, `/open <id>`, `/memory [query]`,
`/note <key>`, `/work`, `/status`, `/continue`, `/retry`, and Ctrl+C to stop
the active step without leaving the CLI.

## ACP

Barney exposes the same local session lifecycle to IDEs through stable ACP v1.
Configure an ACP client to launch `barney-agent`, or run `barney acp` directly.
The transport is JSON-RPC 2.0 over stdio; no hosted service or network listener
is started. The first ACP prompt creates the Barney run in the client's `cwd`,
later prompts reuse it, and cancellation uses the same runtime path as Web and
CLI.

## Body

`~/.barney` is the body. Git there is the biography of becoming.

```
~/.barney/
  barney.sqlite      # agents, runs, memory
  self/              # Self
  skills/ plugins/ mcp/
  worktrees/         # per-run checkouts
```

## License

MIT. Copyright (c) 2026 Sergey Chugay.
