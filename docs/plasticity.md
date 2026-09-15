# Plasticity law

**English** · [Русский](plasticity.ru.md)

The kernel is an immutable brainstem. **Cortical plasticity** lives in the body: weights, prune, sleep, env binding.

> A synapse strengthens only when recall changed the outcome.  
> Unused weight decays.  
> Conflicts resolve by utility (duel).  
> Structure (kernel) changes only via human release.

## Mechanisms

| Mechanism | Behaviour |
|---|---|
| **Hebbian utility** | `strength + wins/transfers − fails − age` |
| **Reconsolidation** | On recall: used+pass ↑ · used+fail ↓ · ignored slight ↓ |
| **Metaplasticity** | Write pressure from frustration/gaps — calm days suppress rules |
| **Prune / archive** | Low-utility quarantine/deprecated → archived in idle sleep |
| **Duel** | Two skills same class+mode → higher utility wins; loser deprecated |
| **Env binding** | Skills carry host env; mismatch → not recalled |
| **Unfreeze** | Frozen with fail streak can demote to verified |

Code: `src/application/plasticity/plasticity.ts`  
Idle item: `plastic_sleep` (after dream, before absorb/self_run/study).

## Relation to other laws

1. [Loop](../README.md) — markers  
2. [Experience](experience.md) — rare write, mandatory recall, transfer lift  
3. [Autonomy](autonomy.md) — agenda self-runs  
4. **Plasticity** — strengthen / forget / consolidate  

Without experience lift, pruning is unsafe. With lift, plasticity stops “crutch pile-up”.

## Fayr alignment

| Fayr | Code |
|---|---|
| Prediction error | `predictionError.ts` → write gate |
| Weight × similarity top-k | `weightedRecall.ts` in bags |
| Procedural skill | `LessonTrail.procedure` → skill body |
| Dream merge | `mergeFailureRules` in dream compress |
| Causal `recall_helped` | four-hand annotate; never pass-alone |
| Spaced retention | `spacedTransfer.ts` schedule + summary |
| Sanitize law | find masks → `<your-…>` writes → tree-wide `grep -r DETECTED_SECRET_` verify (`secretSanitize.ts`) |

Back to [docs index](README.md).
