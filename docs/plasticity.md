# Plasticity law

**English** · [Русский](plasticity.ru.md)

The kernel is an immutable brainstem. **Cortical plasticity** lives in the body: weights, pruning, sleep, environment binding.

> A synapse strengthens only when recall changed the outcome.  
> Unused weight decays.  
> Conflicts resolve by utility (duel).  
> Structure (the kernel) changes only via a human release.

## Mechanisms

| Mechanism | Behaviour |
|---|---|
| **Hebbian utility** | `strength + wins/transfers − fails − age` |
| **Reconsolidation** | On recall: used+pass ↑ · used+fail ↓ · ignored slight ↓ |
| **Metaplasticity** | Write pressure from frustration/gaps — calm days suppress rules |
| **Prune / archive** | Low utility → archived in idle sleep |
| **Duel** | Two skills of the same class+mode → higher utility wins |
| **Env binding** | A skill with the wrong host env is not recalled |
| **Unfreeze** | Frozen skill with a fail streak can demote to verified |

Code: `src/application/plasticity/plasticity.ts`  
Idle item: `plastic_sleep` (after dream, before absorb / self-run / study).

## Relation to other laws

1. Loop — turn markers  
2. [Experience](experience.md) — rare write, mandatory recall, transfer lift  
3. [Autonomy](autonomy.md) — agenda  
4. **Plasticity** — strengthen / forget / consolidate  

Without experience lift, pruning is unsafe. With lift, plasticity stops “crutch pile-up”.

## Fayr alignment

| Fayr | In code |
|---|---|
| Prediction error | `predictionError.ts` → write gate |
| Top-k by weight × similarity | `weightedRecall.ts` |
| Procedural skill | `LessonTrail.procedure` |
| Dream merge | `mergeFailureRules` |
| Causal `recall_helped` | four-hand; never from pass alone |
| Spaced retention | `spacedTransfer.ts` |
| Sanitize law | masks → `<your-…>` writes → tree-wide verify (`secretSanitize.ts`) |

Back to [docs index](README.md).
