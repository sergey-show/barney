# Docs

**English** · [Русский](README.ru.md)

How Barney’s **body** grows around the kernel: tools, plugins, and MCP.

The kernel in `src/` does not change for a task. New capability lives in `~/.barney`.

| Guide | What it covers |
|---|---|
| [Tools](tools.md) | Built-in tool protocol the kernel exposes every turn |
| [Plugins](plugins.md) | Skills, UI, and recipes in `~/.barney/plugins` |
| [MCP](mcp.md) | Local stdio servers the agent can save, start, and call |

Prefer a **plugin/skill** for a new ability. Use **MCP** when the work needs an external stdio server.

Back to the [root README](../README.md).
