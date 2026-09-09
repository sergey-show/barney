# Tools

**English** · [Русский](tools.ru.md)

Tools are the kernel’s protocol. The model does not invent them: the code offers a fixed set, runs the call, and **observes** the result before the next step.

Plugins and MCP add capability **around** this set. They do not replace it.

## Families

On a full turn the agent has these groups:

| Family | Tools | Use for |
|---|---|---|
| Files | `fs_list`, `fs_stat`, `fs_read`, `fs_write`, `fs_edit`, `fs_append`, `fs_mkdir`, `fs_search`, `fs_remove`, `fs_restore` | Worktree files. Prefer these over shell for edits. |
| Shell | `shell` | One command in the worktree, up to 120s. |
| Process | `process_spawn`, `process_list`, `process_logs`, `process_kill` | Long-running builds and servers. |
| Search | `web_search` | Public web. Then open sources in the browser. |
| Browser | `browser_open`, `browser_read`, `browser_screenshot`, `browser_show`, `browser_click`, `browser_fill`, `browser_press`, `browser_scroll` | Headless page. `browser_show` only if the operator asked to see it. |
| Plugins | `plugin_list`, `plugin_read`, `plugin_write`, `plugin_open` | Body skills and UI. See [Plugins](plugins.md). |
| MCP | `mcp_list`, `mcp_write`, `mcp_start`, `mcp_call`, `mcp_stop` | Local MCP servers. See [MCP](mcp.md). |
| Memory | `memory_search`, `memory_write`, `memory_read`, `board_read`, `board_write` | Shared notes and the session board. |
| Team | `plan_set`, `agent_list`, `agent_spawn`, `agent_delegate` | Specialists. Nested children cannot spawn further. |
| Self | `self_status`, `self_log`, `self_commit`, `self_rollback` | Git of `~/.barney`, not the kernel. |

Aliases `skill_*` still work for the plugin tools.

Delegated specialists get the same set **except** `agent_spawn`, `agent_delegate`, `plan_set`, and `self_rollback`.

## Worktree and outside paths

`fs_*` and `shell` run in the session worktree (the operator project, or a folder under `~/.barney/worktrees`).

A path outside the worktree is denied until the operator grants a prefix:

- Web: **Allow**
- CLI: `/allow /path/prefix`
- Evals: `BARNEY_AUTO_APPROVE_OUTSIDE=1`

Kernel sources (`src/`, `DriveSolve.ts`, `Kernel.ts`) cannot be rewritten. That block is physical, not a prompt hint.

## Secrets and observation

Secrets in tool output become `DETECTED_SECRET_<KIND>_<HASH>`. Use the **full token** in `fs_edit` / `sed`. A grep for the letters `DETECTED_SECRET` will miss live secrets on disk.

The same exact failed call is blocked. A tool family that fails twice is saturated: the agent must change family, not hammer the same tool.

`fs_restore` brings back the last good session version of a file after a bad write.

## Short turns

Greetings and “who are you” can skip tools. Anything that needs a file, shell, browser, plugin, or a world fact goes through the full loop: plan → tool → observe → review.

Index: [Docs](README.md).
