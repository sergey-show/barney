# MCP

**English** · [Русский](mcp.ru.md)

MCP here is a **local stdio server in the body**, not a hosted connector and not a settings cloud.

Barney speaks MCP protocol `2024-11-05` over stdio: `initialize` → `tools/list` → `tools/call`. Servers do not autostart on boot. A process lives until `mcp_stop` or until Barney exits.

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

Drop the folder above, or ask Barney to connect it. In a session the agent can `mcp_start` and `mcp_call`.

Name is kebab-case (`github-docs`, `context7`).

## Agent

Barney can attach MCP **itself** on a full turn:

| Tool | What it does |
|---|---|
| `mcp_list` | Recipes on disk and which servers are running |
| `mcp_write` | Save `~/.barney/plugins/<name>/mcp.json` |
| `mcp_start` | Spawn the process, handshake, list tools |
| `mcp_call` | Call a tool on a running server |
| `mcp_stop` | Kill the process; the recipe stays on disk |

Typical loop:

1. `mcp_list` / `plugin_list` — reuse a recipe if it already exists (**kernel-required** before write).
2. `web_search` / `browser_open` — official package/docs (**kernel-required** for a *new* recipe).
3. `mcp_write` — only with evidence; invent without list/search is `BLOCKED by Self`.
4. `mcp_start` — read the tool list from the server.
5. `mcp_call` with `server`, `tool`, and JSON `arguments`.
6. `mcp_stop` when done.

Code gate: `capabilityDiscover.ts` / `DriveSolve.dispatchTool`. Prompt line is advisory; the block is physical.

After `mcp_write`, the MCP is pinned on the instance (`kind: mcp`) and body git records `become: mcp <name>`.

If a turn is stuck, do **not** invent an MCP from the miss. Change tool family and still deliver the result. A new MCP is a body decision, not a workaround.

## Limits

- Timeout per MCP request: 20s.
- Nested specialists may start and call MCP, but should not grow the kernel.
- New `mcp_write` goes through the capability gate (list + search). Updating an existing recipe needs list only.

Index: [Docs](README.md) · [Plugins](plugins.md) · [Tools](tools.md).
