# Docs

**English** · [Русский](README.ru.md)

How Barney’s **body** grows around the kernel: tools, plugins, and MCP.

The kernel in `src/` does not change for a task. New capability lives in `~/.barney`.

| Guide | What it covers |
|---|---|
| [Tools](tools.md) | Built-in tool protocol on every turn |
| [Plugins](plugins.md) | Skills, UI, and recipes in `~/.barney/plugins` |
| [MCP](mcp.md) | Local stdio servers the agent can save, start, and call |
| [Experience](experience.md) | Memory law: rare writes, mandatory recall, hard transfer |
| [Evals](evals.md) | How to run four-hand, Harbor, unit tests |
| [Proof](proof/README.md) | Four-hand reports |
| [Autonomy](autonomy.md) | Agenda law: gaps → idle self-run → drill |
| [Wake](wake.md) | Deferred work: process watch, wall clock; no background reasoning |
| [Plasticity](plasticity.md) | Cortical plasticity: reconsolidation, prune, sleep, duel |
| [Constrain](constrain.md) | OS sandbox defaults + optional Docker profile |
| [SPI](spi.md) | Body providers on stable kernel ports (quarantine→exam) |

Prefer a **plugin or skill** for a new ability. Use **SPI** for port implementations. Use **MCP** only when the work needs an external stdio server.

IDE ACP one-click: [`../extensions/`](../extensions/README.md).

Back to the [root README](../README.md).
