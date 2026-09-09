# Plugins

**English** · [Русский](plugins.ru.md)

A plugin is a capability in the **body**, not in the kernel. Barney can read it, open its UI, or grow a new one after a recovery that worked.

Prefer a plugin/skill over a new MCP server. See [MCP](mcp.md) only when an external stdio process is required.

## Where they live

```
~/.barney/plugins/<name>/
  plugin.json      # name, version, description, optional ui
  SKILL.md         # or PLUGIN.md — what to do
  ui.html          # optional portal UI
  mcp.json         # optional MCP recipe
```

Legacy overlays are also scanned (Barney plugins win on a name clash):

- `~/.barney/skills/`
- `~/.barney/mcp/`
- AgentSkills from Claude / OpenCode / Codex / Claw if those folders exist on the host

The Web **Settings → Plugins** list is this catalog. There is no separate “install plugin” form: drop files into the body, or ask Barney to write them.

## Manifest

`plugin.json`:

```json
{
  "name": "file-viewer",
  "version": "1",
  "description": "Show a worktree file in the portal",
  "ui": "ui.html"
}
```

The name is kebab-case (`file-viewer`). `SKILL.md` may use AgentSkills frontmatter (`name`, `description`); `{baseDir}` in the body is replaced with the plugin directory.

A learned skill from a recovery is written as `learned-<failure-class>` and starts in **quarantine**. Until it is promoted, Barney will not offer it in the catalog or run it.

## Operator

1. Create `~/.barney/plugins/<name>/`.
2. Add `plugin.json` and `SKILL.md` (and `ui.html` if you want a portal panel).
3. Restart is not required: the next `plugin_list` / Settings refresh sees the folder.
4. Body git under `~/.barney` records the change (`self_commit` / idle `become:`).

## Agent

On a full turn Barney can:

| Tool | What it does |
|---|---|
| `plugin_list` | Catalog in `~/.barney` and overlays |
| `plugin_read` | Skill body or a file inside the plugin |
| `plugin_write` | Create/update a file under `~/.barney/plugins/<name>/` |
| `plugin_open` | Open `ui.html` in the portal (or the markdown if there is no UI) |

Typical growth:

1. `plugin_list` — do not invent a duplicate.
2. `plugin_read` — follow an existing scheme.
3. If nothing fits and a recovery actually worked — write a small skill, not a new MCP.
4. `plugin_open` when the operator should see a panel.

`plugin_write` is for the body. It cannot patch `src/`. Self-authored plugins are admitted as quarantine until they prove themselves.

Index: [Docs](README.md) · [Tools](tools.md).
