# Autonomy law

**English** · [Русский](autonomy.ru.md)

Self-learning is not autonomy. Autonomy needs a **bounded agenda** that can start work without an operator prompt.

> An agenda item is written rarely (from repeated PE/backlog gaps),  
> raised in idle as a self-run,  
> proven with ZPD-3 markers,  
> otherwise dropped.

## Three layers

| Layer | What it is | Source |
|---|---|---|
| **Gap** | Repeated PE fail (`pe:1`) or unfinished backlog (≥2) | episodes + backlog |
| **Agenda item** | Local **ZPD-3** drill + reason | `proposeAgendaItem` |
| **Self-run** | `createRun` from idle | Kernel `tick` → `self_run` |

Code: `src/application/autonomy/agenda.ts`, idle wiring in `idleTick.ts` / `Kernel.tick`.

## Gates

- Design sealed before study or self-run  
- No self-run while an operator session is open  
- Cooldown after a self-run  
- Cap on pending drills; one class at a time  
- Drill goals are local files (`recovery-<class>.md` + `proof-*.py` / soft harness), not open-world quests  
- Still: do not message the operator first from idle  
- **Inner think never writes agenda** (hints logged as ignored)  
- **Capability map is self-model only** — not an agenda writer  
- **Self-run done ≡ ZPD-3 proof** (`ZPD_PROOF fail=1` + `pass=1`, or soft oracle harness); else status `dropped`  

## Relation to experience

Autonomy without working experience is useless. Order:

1. Hard transfer lift — see [Experience](experience.md)  
2. Agenda from real PE/backlog gaps  
3. Quarantine skill clears the same exam (recall+use → SkillsLock) — see skill loop in experience law  
4. Capability map + decay → self-model (pulse / web), not agenda  
5. Self-run drills are **ZPD-3 only**: executable proof must print `ZPD_PROOF fail=1` then `ZPD_PROOF pass=1` (Kernel drops if markers are missing)  

During dream idle, **Learned** appendages and rule lines may consolidate (dedupe/compress). The immune constitution base above `# Learned` is never rewritten by the model.

## Idle order

`seed_samost` → board → dream → absorb_shadow → **inner_think** (if waiting on wake) → **self_run** → study → **inner_think** (long idle)

Back to [docs index](README.md).
