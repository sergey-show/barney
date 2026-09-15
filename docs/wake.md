# Wake law

**English** · [Русский](wake.ru.md)

The agent does **not** think in the background. It arms a **wake**; the kernel delivers it; a normal turn continues.

> Arm rarely → timer or process exit fires → observe → act → review.

## Why

`process_spawn` already runs long work, but the model has to poll. There was no durable “resume later” for exits, log patterns, or wall-clock time.

## Kinds

| Kind | Tool | Fires when |
|---|---|---|
| process exit | `wake_when_process on=exit` | process leaves `running` |
| process log | `wake_when_process on=log` | logs contain a match or `/regex/i` |
| defer / at | `wake_at afterMs` / `at` | wall clock |
| interval | `wake_at everyMs` | repeats (min 5m); re-arms after firing |

Stored in body memory: `wake/<agentId>` (JSON). Caps: at most 8 armed, defer at least 15s, interval between 5 minutes and 24 hours.

## Tools

- `wake_when_process` — watch a `process_spawn` id  
- `wake_at` — `afterMs`, `at` (ISO), or `everyMs`  
- `wake_list` / `wake_cancel`

## Delivery

1. Process exit (`ProcessTable.onSettled`) or a 15s timer → `Kernel.deliverWakes`  
2. A due wake appends a system note on the run  
3. If no step is in flight, `SessionService.prompt` resumes with `wakePrompt(...)`  
4. Interval wakes re-arm; others become `fired`

Idle psyche and the autonomy agenda stay separate: a wake is **deferred session work**, not an autonomy drill.

## Out of scope

- A forever LLM loop in the background  
- An open cron language  
- Mixing agenda gaps with operator schedules  

Code: `src/application/autonomy/wake.ts`, `runWakeTool.ts`, `Kernel.deliverWakes`.

Back to [docs index](README.md).
