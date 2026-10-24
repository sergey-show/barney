# Operator guide

**English** · How Self, board, oracle, and PE show up while you work.

## Surfaces

| Surface | What you see |
|---|---|
| Web **Self** pane | Compass, light/shadow, **task board**, existence, episodes (+ next hint) |
| Chat chips | Latest `oracle:` / `prediction_error:` from the transcript |
| CLI `/status` | Status + last oracle/PE lines |
| CLI `/self` | Board, existence, compass, last episode hint |

## Soft vs DevOps

- **DevOps**: byte evidence + structural Review. Soft matrix is **not** invented from bare `soft_*` tokens.
- **Soft**: declare ```expectation JSON```. `OraclePort` owns `outcomeOk`. Failures reopen the same-turn persist loop.

## Permissions / doom

| Layer | Role |
|---|---|
| `selfGate` | Constitution blocks |
| `observeTool` + saturated families | Wanting-without-liking / family budget |
| `AgentLoop` doom_loop | Identical tool signature repeats → halt + family trip |
| SessionLock | Single-flight per run (`replace` chat / `reject` → BusyError) |

## Chat UX

| Piece | Behavior |
|---|---|
| Live assistant bubble | `run.text_delta` → chat row while busy; commit via `run.transcript_item` |
| Partial on abort | Double-press Stop; keep streamed text as `assistant` + `meta.partial` |
| Send while busy | Replace-mode lock — new message cancels the in-flight step |
| Edit / resubmit | `POST …/messages` `{ replaceFromId }` truncates from that item |
| Tool cards | `run.tool_*` title / argsPreview / preview / durationMs |
| Summary cursor | `POST …/compact` or `/compact`; auto at critical pressure; `meta.summary` |
| WS subscribe | `{ type:"subscribe", runId }` filters fan-out; patches via `transcript_item` |
| Context pressure | ~70%/~~90% → tighter `packSession` before hard budget fail |
| Tool JSON Schema | Optional params → `type: [t,"null"]` for OpenAI-compat |

## Session harness

| Piece | Behavior |
|---|---|
| Overflow retry | context overflow → compact + one retry |
| Tool offload | long tool stdout → `.barney/tool-out/*` + `full_output_path` |
| Steer / followUp | `whenBusy: steer\|followUp` queues mid-run / after settle |
| Parallel tools | read-safe tools run concurrently in one step |
| Truncated tools | `finish_reason=length` → fail tool calls, ask re-issue |
| Structured compact | Goal/Progress/Decisions + read/modified file lists |
| AGENTS.md | auto-ingest from worktree into act system |
| MCP exposure | `direct` / `deferred` / `hidden` + `tool_search` |
| Codemode | `codemode` tool — short JS calling allowlisted reads |
| Session tree | `POST …/fork`, `…/branches`, switch — alternate paths |

## Competence closures (A → C → B)

| Piece | Behavior |
|---|---|
| Experience recall | Always `experience_recall_ready` + episode `recall_*`; short→full when skill/rule bags present |
| Task study | `reuse=fresh` + empty recall bags → force deep research before act; `study_write` saves study note + provisional rules for next recall |
| Experience pulse | Idle `metrics/experience/*` + psyche `experiencePulse` |
| SPI verify-before-done | Active verify providers gate pass inside persist (reopen on fail) |
| Stall → tactic | Flat progress rotates Prefer / can saturate failed family |
| Phase models | Optional `BARNEY_FAST_MODEL` for planner/reviewer/embedder |
| Autonomy agenda | Only PE/backlog gaps; ZPD-3 proof or drop; no inner invent |

**Later:** models.dev catalog; full SSE MCP transport.

## LSP (optional Body)

`BARNEY_LSP=1` → lightweight `tsc --noEmit` diagnostics appended as `lsp_diagnostics:` into review evidence. Prefer SPI `verify` providers for project-specific checks — LSP is not Core.

## Harbor

- `BARNEY_HARBOR_TIMEOUT_MS` (default `600000`) → `AbortSignal.timeout`
- `BARNEY_HARBOR_MAX_ATTEMPTS` (default `24`)
- `BARNEY_SPI_AFFECTS_OUTCOME=1` → SPI verify can clear `outcomeOk`

## Related

`docs/oracle.md` · `docs/spi.md`
