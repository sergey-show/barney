# Experience law

**English** · [Русский](experience.ru.md)

Barney’s loop law is measurable. Experience is only real when it is **narrow, forced into recall, and proven on a new task**.

> A lesson is written rarely, recalled mandatorily, checked on a shifted task, otherwise dropped.

Marker lift proves the **loop**.  
`transfer_success_lift = pass(kernel-test) − pass(kernel-fresh)` proves **experience**.

## Three layers (measure separately)

| Layer | What it is | When it may help |
|---|---|---|
| **Episode fact** | “On this goal, X worked” | Same goal / memorize |
| **Failure rule** | “On failure mode F, don’t A — do B” | Similar failure mode |
| **Skill** | Reusable action path | Other task class (transfer) |

Not every PASS writes a skill. Not every FAIL writes a rule. Pins prefer **prediction error** (expectation ≠ fact).

| Outcome | Write |
|---|---|
| PASS + failed path → different path → success + PE | `skill_candidate` (quarantine; may carry `procedure`) |
| FAIL + PE + repeated/structural mode + concrete directive | `failure_rule` |
| PASS + house convention pin | `lesson_pin` |
| Otherwise | `episode_only` (no pin into body rules/skills) |

Code: `src/application/experience/experienceLayers.ts`, `predictionError.ts`.

## Mandatory pre-act recall

Before act, inject bags ranked by **weight × similarity** (synaptic competition):

1. **Shadow** — similar fails  
2. **Rules** — failure-mode directives  
3. **Skills** — quarantine / verified / frozen body hints (incl. procedure traces)  

Then log:

```text
recall_hit: 0/1
recall_used: 0/1   # plan/act/tools echoed a recalled fingerprint
recall_helped: 0/1/?  # causal only (four-hand); never inferred from pass alone
```

Code: `src/application/experience/experienceRecall.ts`, `weightedRecall.ts` (wired in `DriveSolve`).

## Four-hand hard transfer

Friendly suites where both arms score 100% do **not** measure experience.

Protocol:

1. sterile home  
2. **kernel-train** (write lessons)  
3. **kernel-test** (same body)  
4. **no-kernel** (same model, no body)  
5. **kernel-fresh** (full kernel, empty body)

Claim for experience: **kernel-test > kernel-fresh** on a shifted test.  
Causal `recall_helped` on kernel-test: **pass ∧ fresh fail ∧ recall_used**.

Seed cases: `HARD_TRANSFER_CASES` in `src/application/evaluation/fourHandCurriculum.ts`  
(`house-redact`, `house-merge` — house conventions taught in train only).

Spaced retention schedule (immediate / +1d / +7d): `spacedTransfer.ts`.  
Immediate probe is embedded in four-hand reports; later delays: `barney eval spaced <observations.json>`.

## Dream consolidation

Idle dream compress merges near-duplicate failure rules (`mergeFailureRules`) before applying heuristics — consolidate failures, not only shadow→heuristics.

## Metrics

| Metric | Meaning |
|---|---|
| `transfer_success_lift` | test pass: kernel-with-train − kernel-fresh |
| `recall_hit_rate` | steps with relevant bags |
| `recall_used_rate` | steps where plan/act echoed recall |
| `recall_helped` | causal only (four-hand annotate) |
| `spaced retention` | lift across delays (`retains` / `fades`) |
| `skill_reuse_rate` | verified skill used on a new task |
| `false_skill_rate` | pinned skill that did not help / hurt |
| `shadow_to_rule` | fails → rules that later hit |

## Fayr alignment

See [plasticity.md](plasticity.md) table and `bio/fayr.md`. Target wiring: PE gate, weighted top-k, procedural skills, dream merge, causal helped, spaced probes.


Back to [docs index](README.md).
