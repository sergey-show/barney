# Autonomy law

**English** · [Русский](autonomy.ru.md)

Self-learning is not autonomy. Autonomy needs a **bounded agenda** that can start work without an operator prompt.

> An agenda item is written rarely (from repeated gaps),  
> raised in idle as a self-run,  
> proven with the same review loop,  
> otherwise dropped.

## Three layers

| Layer | What it is | Source |
|---|---|---|
| **Gap** | Repeated fail or unfinished backlog | episodes + backlog |
| **Agenda item** | Local drill + reason | `proposeAgendaItem` |
| **Self-run** | `createRun` from idle | Kernel `tick` → `self_run` |

Code: `src/application/autonomy/agenda.ts`, idle wiring in `idleTick.ts` / `Kernel.tick`.

## Gates

- Design sealed before study or self-run  
- No self-run while an operator session is open  
- Cooldown after a self-run  
- Cap on pending drills; one class at a time  
- Drill goals are local files (`recovery-<class>.md`), not open-world quests  
- Still: do not message the operator first from idle  

## Relation to experience

Autonomy without working experience is useless. Order:

1. Hard transfer lift — see [Experience](experience.md)  
2. Agenda from real gaps  
3. Capability map / decay later  

## Idle order

`seed_samost` → board → dream → absorb_shadow → **self_run** → study  

Back to [docs index](README.md).
