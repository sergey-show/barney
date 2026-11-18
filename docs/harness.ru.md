# Автономия harness

**Русский** · [English](harness.md)

Физические ворота безопасной автономии: лестница разрешений, пауза elicitation,
world-state после compact, консолидация памяти, risk review, роли/mailbox,
workspace-delta steer, профили sandbox и протокол start vs steer.

> В коде и документации — только нейтральные имена.  
> Автономия без границ — не цель.

## Слои

| Слой | Суть | Код |
|---|---|---|
| **P0 ApprovalLadder** | `unless_trusted` / `on_request` / `on_failure` / `never`; high-risk спрашивает | `ApprovalLadder.ts` |
| **P0 ExecPolicyAmendment** | Запоминает allow как prefix; hard deny всегда сильнее | `ExecPolicyAmendment.ts` |
| **P0 ElicitationGate** | Пауза mid-tool до `/approve`, `/deny` или steer | `ElicitationGate.ts` |
| **P0 WorldState** | Compact → машинное состояние продолжения | `worldState.ts` |
| **P1 MemoryConsolidator** | Preference vs task, redact, бюджет ~10KB | `memoryConsolidator.ts` |
| **P1 RiskReviewPass** | Reopen done при secret/destructive/unverified | `riskReviewPass.ts` |
| **P1 Roles + Mailbox** | Контракты ролей + почта между агентами | `AgentRoleSpec.ts`, `AgentMailbox.ts` |
| **P1 WorkspaceDeltaSteer** | Опрос mtime → tagged steer | `WorkspaceDeltaSteer.ts` |
| **P2 Sandbox / Codemode / Steer** | Профили изоляции и жёсткий протокол очередей | `OsSandbox.ts`, `codemode.ts`, `MessageQueue.ts` |

## Управление

| Команда / env | Эффект |
|---|---|
| `/approve <signature>` | Session allow + amendment → Light tooling |
| `/deny <signature>` | Session deny |
| Steer на паузе | Ответ на elicitation |
| `BARNEY_APPROVAL_MODE` | Режим лестницы |
| `BARNEY_AUTO_APPROVE_TOOLS=1` | Без интерактива (CI) |
| `BARNEY_SANDBOX_PROFILE` / `BARNEY_CODEMODE_PROFILE` | Профили исполнения |

## Связано

- [Constrain](constrain.ru.md) · [Operator](operator.ru.md) · [Individuation](individuation.ru.md)
