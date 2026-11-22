# Harness autonomy

**English** · [Русский](harness.ru.md)

Physical gates that widen safe agency: approval ladder, elicitation pause,
world-state compact, memory consolidation, risk review, roles/mailbox,
workspace-delta steer, sandbox profiles, and start-vs-steer protocol.

> No foreign product names in code or docs.  
> Autonomy without softer boundaries is not the goal.

## Layers

| Layer | What | Code |
|---|---|---|
| **P0 ApprovalLadder** | `unless_trusted` / `on_request` / `on_failure` / `never`; high-risk tools ask | `src/domain/guard/ApprovalLadder.ts` |
| **P0 ExecPolicyAmendment** | Remember operator allows as prefixes; hard deny always wins | `src/domain/guard/ExecPolicyAmendment.ts` |
| **P0 ElicitationGate** | Mid-tool pause until `/approve`, `/deny`, or steer answer | `src/application/services/ElicitationGate.ts` |
| **P0 WorldState** | Compact emits machine-readable continuation state | `src/application/context/worldState.ts` |
| **P1 MemoryConsolidator** | Preference vs task summary, secret redact, ~10KB budget | `src/application/experience/memoryConsolidator.ts` |
| **P1 RiskReviewPass** | Reopen done on secret/destructive/unverified signals | `src/application/context/riskReviewPass.ts` |
| **P1 Roles + Mailbox** | explorer/implementer/reviewer contracts + cross-agent mail | `src/application/session/AgentRoleSpec.ts`, `AgentMailbox.ts` |
| **P1 WorkspaceDeltaSteer** | Poll mtimes → tagged steer | `src/application/services/WorkspaceDeltaSteer.ts` |
| **P2 Sandbox profiles** | `workspace_write` / `read_only` / `full` | `src/infrastructure/sandbox/OsSandbox.ts` |
| **P2 Codemode profiles** | `read` (default) / `mutate` | `src/application/tools/codemode.ts` |
| **P2 Steer protocol** | Reject empty/cap; source tags; steer requires active run | `MessageQueue.ts`, `SessionService.ts` |

## Operator controls

| Command / env | Effect |
|---|---|
| `/approve <signature>` | Session allow + optional durable amendment → Light tooling claim |
| `/deny <signature>` | Session deny; resolves open elicitation |
| Steer while paused | Answers the oldest elicitation |
| `BARNEY_APPROVAL_MODE` | Ladder mode (default `unless_trusted`) |
| `BARNEY_AUTO_APPROVE_TOOLS=1` | CI/eval: skip interactive ask |
| `BARNEY_ELICITATION_MS` | Wait budget for mid-tool answers |
| `BARNEY_SANDBOX_PROFILE` | `workspace_write` \| `read_only` \| `full` |
| `BARNEY_CODEMODE_PROFILE` | `read` \| `mutate` |

## Individuation hooks

- Operator amend → Light `tooling` with `policy:` / `cmd:` refs  
- Blind auto-allow without evidence stays a Shadow risk (prefer amend after real allow)  
- World-state risks feed RiskReviewPass and appraisal context  

## Related

- [Constrain](constrain.md) — OS sandbox  
- [Operator](operator.md) — steer / SessionLock  
- [Individuation](individuation.md) — Light × Shadow  
- [Experience](experience.md) — memory law (external admission before durable pins)  
