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

Not every PASS writes a skill. Not every FAIL writes a rule.

| Outcome | Write |
|---|---|
| PASS + failed path → different path → success | `skill_candidate` (quarantine) |
| FAIL + repeated or structural mode + concrete directive | `failure_rule` |
| Otherwise | `episode_only` (no pin into body rules/skills) |

Code: `src/application/experience/experienceLayers.ts`.

## Mandatory pre-act recall

Before act, inject three bags:

1. **Shadow** — similar fails  
2. **Rules** — failure-mode directives  
3. **Skills** — quarantine / verified / frozen body hints  

Then log:

```text
recall_hit: 0/1
recall_used: 0/1   # plan/act/tools echoed a recalled fingerprint
recall_helped: 0/1 # correlational until 4-hand; 1 only if hit+used+pass
```

Code: `src/application/experience/experienceRecall.ts` (wired in `DriveSolve`).

## Four-hand hard transfer

Friendly suites where both arms score 100% do **not** measure experience.

Protocol:

1. sterile home  
2. **kernel-train** (write lessons)  
3. **kernel-test** (same body)  
4. **no-kernel** (same model, no body)  
5. **kernel-fresh** (full kernel, empty body)

Claim for experience: **kernel-test > kernel-fresh** on a shifted test.

Seed cases: `HARD_TRANSFER_CASES` in `src/application/evaluation/fourHandCurriculum.ts`  
(`sanitize-shifted`, `merge-shifted`).

## Metrics

| Metric | Meaning |
|---|---|
| `transfer_success_lift` | test pass: kernel-with-train − kernel-fresh |
| `recall_hit_rate` | steps with relevant bags |
| `recall_used_rate` | steps where plan/act echoed recall |
| `skill_reuse_rate` | verified skill used on a new task |
| `false_skill_rate` | pinned skill that did not help / hurt |
| `shadow_to_rule` | fails → rules that later hit |


Back to [docs index](README.md).
