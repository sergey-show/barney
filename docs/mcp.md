# MCP

**English** · [Русский](mcp.ru.md)

MCP here is a **local stdio server** in the body, not a hosted connector and not a settings cloud.

Barney speaks MCP protocol `2024-11-05` over stdio: `initialize` → `tools/list` → `tools/call`. There is no autostart on boot. A server lives until `mcp_stop` or until Barney exits.

Prefer a [plugin](plugins.md) if a skill or UI is enough. MCP is for an external process the kernel does not ship.

## Recipe

Saved as a plugin:

```
~/.barney/plugins/<name>/
  plugin.json
  mcp.json
```

`mcp.json`:

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_TOKEN": "..."
  }
}
```

`command` + `args` are spawned in the **session worktree**. Process env is a small allowlist (`PATH`, `HOME`, locale, temp) plus `env` from this file. Cloud keys from the Barney process are **not** forwarded unless you put them in `env`.

Also discovered:

- Claude-style `.mcp.json` / `mcpServers` inside a plugin bundle
- legacy `~/.barney/mcp/<name>/mcp.json`

The Web plugin list shows an **MCP** badge. There is no separate “Add MCP server” form.

## Operator

Drop the folder above, or ask Barney to connect it. Then in a session the agent can `mcp_start` and `mcp_call`.

Name is kebab-case (`github-docs`, `context7`).

## Agent

Barney can attach MCP **itself** on a full turn:

| Tool | What it does |
|---|---|
| `mcp_list` | Recipes on disk and which servers are running |
| `mcp_write` | Save `~/.barney/plugins/<name>/mcp.json` |
| `mcp_start` | Spawn the process, handshake, list tools |
| `mcp_call` | Call a tool on a running server |
| `mcp_stop` | Kill the process; the recipe stays |

Typical loop:

1. `mcp_list` — reuse a recipe if it already exists.
2. `mcp_write` — only if a stdio server is actually needed.
3. `mcp_start` — read the tool list from the server.
4. `mcp_call` with `server`, `tool`, and JSON `arguments`.
5. `mcp_stop` when done.

After `mcp_write`, the MCP is pinned on the instance (`kind: mcp`) and the body git records `become: mcp <name>`.

If a turn is stuck, do **not** invent an MCP from the miss. Change tool family and still deliver the result. A new MCP is a body decision, not a workaround.

## Limits

- Timeout per MCP request: 20s.
- Nested specialists may start/call MCP, but should not grow the kernel.
- `mcp_write` is not the same as skill quarantine: a recipe can be saved immediately. Still prefer a verified skill when the recovery is “after this family failed, that family delivered”.

Index: [Docs](README.md) · [Plugins](plugins.md) · [Tools](tools.md).
