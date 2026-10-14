# Harbor 15-task slice — qwen3.8 + Barney (2026-10-14)

Jobs:
- A (rerun after cp/ls pin fix): `jobs/harbor-5tasks-rerun/2026-10-14__12-05-14`
- B: `jobs/harbor-batch-b/2026-10-14__13-37-58`
- C: `jobs/harbor-batch-c/2026-10-14__14-47-42`

## Scoreboard

| Batch | Pass (reward 1.0) | Fail (0.0) | Infra / no verifier |
|-------|-------------------|------------|---------------------|
| A     | 3/5               | 2          | 0                   |
| B     | 4/5               | 1          | 0*                  |
| C     | 0/5               | 3          | 2                   |
| **Σ** | **7/15 (47%)**    | **6**      | **2**               |

\* `pypi-server`: reward 1.0 but agent exit 137 (hung → kill); work was already on disk.

Excluding the two apt-setup failures (qemu, pytorch): **7/13 ≈ 54%**.

### Per task

| Task | Reward | Class |
|------|--------|-------|
| fix-git | 1.0 | construct / git |
| openssl-selfsigned-cert | 1.0 | construct |
| nginx-request-logging | 1.0 | construct (pin fix validated) |
| sanitize-git-repo | 0.0 | over-edit |
| write-compressor | 0.0 | hard RE, no deliverable |
| kv-store-grpc | 1.0 | construct + background process |
| log-summary-date-ranges | 1.0 | construct |
| pypi-server | 1.0 | construct + server (agent hung after) |
| merge-diff-arc-agi-task | 1.0 | git merge + small algo |
| regex-log | 0.0 | almost-right regex |
| schemelike-metacircular-eval | 0.0 | analysis without ship |
| path-tracing | 0.0 | RE without ship |
| caffe-cifar-10 | 0.0 | env disk/apt, never built |
| qemu-alpine-ssh | — | apt 404 in agent install |
| pytorch-model-recovery | — | apt GPG error in agent install |

## What the full logs show

### Works (medium construct)
Barney + qwen3.8 reliably finishes multi-step build/config tasks when the deliverable is concrete files + a checkable command. Examples: grpc KV server, nginx logging, openssl cert pack, CSV log summary, git merge+ARC, vectorops+pypiserver.

Review often **fails once then passes** (openssl, nginx, log-summary, merge-diff). The second pass uses richer console evidence. The cp/ls delivery-credit fix is doing its job on nginx.

### Model incompleteness (hard / open-ended)
On RE and “invent the missing program” tasks the model **reasons a lot and ships nothing**:
- `write-compressor` — no `python3`, never wrote `data.comp`; review pin “Not yet written” is correct.
- `path-tracing` — objdump loop, never wrote `image.c`.
- `schemelike` — design monologue; `eval.scm` missing or unproven.

This is model capability + weak “force write the file” closure, not a false review fail.

### Near-miss
- `regex-log` — wrote `/app/regex.txt`, review correctly flagged `.*?` vs last-date; agent thrashed `fs_edit` without a local gold test; verifier still wrong on two dates.
- `sanitize-git-repo` — secrets replaced (2/3 tests pass) but an extra path was touched → `test_no_other_files_changed`. Over-scoping edits, not “forgot to write”.

### Agent hang
`pypi-server`: after a thinking turn (“now start pypiserver…”) status stayed `acting` for ~25 min with **no further sqlite/transcript updates and no live Ollama call**. Package + server were already correct; kill −9 → exit 137; verifier still 1.0. Same pattern risk on any long-lived server task if the next LLM/tool step never fires.

### Infra (not Barney)
- `qemu-alpine-ssh`, `pytorch-model-recovery`: failed in `apt-get install` during agent setup (404 / invalid GPG via `198.18.0.161`). Agent never started.
- `caffe-cifar-10`: agent ran but apt archives had no free space; never reached a real Caffe build.

## Conclusions

1. **On medium construct TB tasks, Barney’s loop (act → evidence → review → retry) is competitive with qwen3.8** — roughly half the 15-slice, and ~¾ of A+B.
2. **Hard fails are mostly “never wrote the artifact”**, and review pins catch that honestly. Closing the loop needs stronger leftover-work nudges / refuse-done-without-path, not softer review.
3. **sanitize** needs a “only touch listed paths” habit (or a pre-done `git diff` against allowlist).
4. **regex** needs “write a local pytest/sample before claim done” — review alone is not enough if the model ignores the pin.
5. **Must fix hang**: if `acting` and transcript/sqlite idle > N minutes with no in-flight shell under timeout, abort the step or re-prompt. Also treat “thinking-only” model turns as incomplete.
6. **Eval hygiene**: apt mirror/GPG and disk space polluted batch C; separate infra errors from agent score when reporting.

## Suggested next fixes (priority)

1. In-process idle watchdog for `acting`/`reviewing` (no external kill −9).
2. After review fail with pin “Not yet written: PATH”, next act must prefer `fs_write`/`process_spawn` over more analysis.
3. Optional allowlist diff check before `done` when goal mentions “only change X”.
4. Harbor setup: retry apt / pre-bake curl+git into images to avoid C-style install flakes.
