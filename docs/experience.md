# Experience law

**English** · [Русский](experience.ru.md)

Barney’s loop law is measurable. Experience counts only when it is **narrow, forced into recall, and proven on a new task**.

> A lesson is written rarely, recalled mandatorily, checked on a shifted task — otherwise dropped.

Marker lift proves the **loop**.  
`transfer_success_lift = pass(kernel-test) − pass(kernel-fresh)` proves **experience**.

## Three layers (measure separately)

| Layer | What it is | When it may help |
|---|---|---|
| **Episode fact** | “On this goal, X worked” | Same goal |
| **Failure rule** | “On failure mode F, don’t A — do B” | Similar failure mode |
| **Skill** | A reusable action path | Another task class (transfer) |

Not every PASS writes a skill. Not every FAIL writes a rule. Pins prefer **prediction error** (expectation ≠ fact).

| Outcome | What gets written |
|---|---|
| Success after changing path + prediction error | skill candidate (quarantine; may carry `procedure`) |
| Fail + prediction error + repeated/structural mode + concrete directive | failure rule |
| Success + house-convention pin | pinned lesson |
| Otherwise | episode only (nothing pinned into body rules/skills) |

Code: `src/application/experience/experienceLayers.ts`, `predictionError.ts`.

## Mandatory recall before act

Before the act, inject bags ranked by **weight × similarity**:

1. **Shadow** — similar past fails  
2. **Rules** — directives for that failure mode  
3. **Skills** — quarantine / verified / frozen body hints (including procedures)  

Then log:

```text
recall_hit: 0/1      # a lesson was found
recall_used: 0/1     # plan/act/tools actually echoed the lesson
recall_helped: 0/1/? # causal help only (four-hand); never inferred from pass alone
```

Code: `src/application/experience/experienceRecall.ts`, `weightedRecall.ts` (wired in `DriveSolve`).

## Four-hand hard transfer

If the suite is too easy and both arms score 100%, that does **not** measure experience — there is nothing to separate.

Protocol:

1. sterile home directory  
2. **kernel-train** — write lessons  
3. **kernel-test** — same model, same trained body  
4. **no-kernel** — same model, no body  
5. **kernel-fresh** — full kernel, empty body  

Claim for experience: on a shifted test, **the trained body beats the fresh one**.  
Causal “recall helped” on kernel-test: **pass ∧ fresh fail ∧ recall was used**.

Seed cases: `HARD_TRANSFER_CASES` in `src/application/evaluation/fourHandCurriculum.ts`  
(`house-redact`, `house-merge` — house conventions taught only in train).

```bash
BARNEY_ABLATION_HOST=http://127.0.0.1:11434/v1 \
BARNEY_ABLATION_MODEL=qwen3.8:latest \
barney eval experience --out ./tmp/fourhand-proof
```

### Measured run (2026-09-15, `qwen3.8:latest`)

| Case | kernel-test | no-kernel | kernel-fresh | lift | recall_helped |
|---|---|---|---|---|---|
| `house-redact` | PASS | FAIL | FAIL | 1 | 1 |
| `house-merge` | PASS | FAIL | FAIL | 1 | 1 |

Verdict: experience helps · mean transfer lift **1.00**. Report: `tmp/fourhand-proof/fourhand-report.json`.

Spaced retention (immediate / +1 day / +7 days): `spacedTransfer.ts`.  
The immediate probe is already in the four-hand report; later delays: `barney eval spaced <observations.json>`.

## Dream consolidation

In idle, dream compress merges near-duplicate failure rules (`mergeFailureRules`) — consolidate failures, not only Shadow → heuristics.

## Metrics

| Metric | Meaning |
|---|---|
| `transfer_success_lift` | test pass rate: trained body − fresh body |
| `recall_hit_rate` | steps where relevant memory was found |
| `recall_used_rate` | steps where plan/act actually answered the recall |
| `recall_helped` | causal help only (four-hand) |
| spaced retention | lift across delays (holds / fades) |
| `skill_reuse_rate` | verified skill used on a new task |
| `false_skill_rate` | pinned skill that did not help / hurt |
| `shadow_to_rule` | fails → rules that later hit |

## Fayr alignment

See [plasticity.md](plasticity.md) and `bio/fayr.md`.


Back to [docs index](README.md).
