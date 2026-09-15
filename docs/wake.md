# Wake law

**English** · [Русский](wake.ru.md)

The agent does **not** background-reason. It arms a **wake**; the kernel delivers it; a normal turn resumes.

> Arm rarely → tick / process-exit fires → observe → act → review.

## Why

`process_spawn` already runs long work, but the model must poll. There was no durable “resume later” primitive for exits, log patterns, or wall-clock delays.

## Kinds

| Kind | Arms with | Fires when |
|---|---|---|
| `process_exit` | `wake_when_process on=exit` | process leaves `running` |
| `process_log` | `wake_when_process on=log` | logs match substring or `/regex/i` |
| `defer` / `at` | `wake_at afterMs` / `at` | wall clock |
| `interval` | `wake_at everyMs` | repeats (min 5m); re-arms |

Stored in body memory: `wake/<agentId>` (JSON). Caps: 8 armed, `afterMs ≥ 15s`, `everyMs ∈ [5m, 24h]`.

## Tools

- `wake_when_process` — watch a `process_spawn` id  
- `wake_at` — `afterMs` | `at` (ISO) | `everyMs`  
- `wake_list` / `wake_cancel`

## Delivery

1. `ProcessTable.onSettled` and a 15s timer call `Kernel.deliverWakes`  
2. Due wakes append a system note on the run  
3. If no step is inflight, `SessionService.prompt` resumes with `wakePrompt(...)`  
4. Interval wakes re-arm; others become `fired`

Idle psyche / agenda stays separate: wakes are **session deferred work**, not autonomy drills.

## Not in scope

- A forever LLM loop in the background  
- Open cron DSL  
- Mixing agenda gaps with operator schedules  

Code: `src/application/autonomy/wake.ts`, `runWakeTool.ts`, `Kernel.deliverWakes`.

Back to [docs index](README.md).
