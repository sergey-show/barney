# Individuation law

**English** · [Русский](individuation.ru.md)

Self is not two success/fail logs. Individuation is the ongoing integration of **Light** (proven spectrum) and **Shadow** (rejected, unused, limits, blinds) into a pre-act appraisal that chooses a path.

> Light is only what evidence supports.  
> Shadow is typed, capped, and pruned.  
> Appraisal is deterministic — never an LLM psychologist.  
> Capability / skills remain the statistical canon; Samost is a projection.

## Definitions

| Pole | Meaning | Not |
|---|---|---|
| **Light** | Conscious spectrum the body is ready to apply (`skill` / `method` / `tooling` / `domain`) | Victory diary, self-praise |
| **Shadow** | Archive of `fail` / `rejected` / `unused` / `limit` / `blind` | Raw chat errors only |
| **Appraisal** | `competent \| partial \| blind \| constrained` → `act \| study \| self_run \| fork \| park` | Soft planner guess |

## Gates (anti-patterns)

| Risk | Gate |
|---|---|
| Shadow bloat | Caps (12/kind, 40 total); `rejected` only on real path change; plastic prune |
| Light vanity | Requires `refs` + exam/helped/transfer; study_write ≠ Light |
| LLM appraisal | Pure function + verdict table; tests without a model |
| Double book with capability | Capability = canon; Light/Shadow = projection with refs |
| Short-chat noise | Greetings skip appraisal/study (same as task study) |

## Turn flow

```
recall bags + capability
        │
        ▼
appraiseSelf ──► log self_appraisal:
        │
        ├─ blind      → force study (new_task_class) → study_write
        ├─ constrained→ park / narrow
        ├─ conflict   → fork (optional)
        └─ competent/partial → act with Light/Shadow prompt slice
        │
        ▼
outcome → emit Light/Shadow upserts → project Samost
```

## Code

- Types / store / appraisal: `src/application/psyche/individuation.ts`
- Wired in `DriveSolve` (pre-act + emitters), idle prune in `Kernel` plastic_sleep
- Policy: `SolvePolicy.onBlind` / `onConstrained` / `onConflict`

## Relation

1. [Experience](experience.md) — rare write, recall, transfer  
2. [Autonomy](autonomy.md) — blind → agenda / self_run  
3. [Plasticity](plasticity.md) — prune / duel  
4. Task study — special case of `verdict=blind`

Back to [docs index](README.md).
