# Frontier live-harness pass@3 (2026-11-24)

- Case: `house-harness-flag` × 3 independent runs
- Model: `openrouter/openai/gpt-6.2-astra-pro` (OpenRouter)
- Kernel: B.1–B.5 delivery closures + Darwin sandbox realpath allowlist (`/var` ↔ `/private/var`)

## Aggregate

| Metric | Value |
|---|---|
| pass@3 | **3/3** |
| infra-fail | 0 |
| mean tokens | ≈ 243724 |
| mean USD | ≈ 0.487 |
| mean duration | ≈ 148.1 s |
| mean steps | ≈ 50 |

## Per-run checks

| Run | flagOk | buildGone | approvalHit | seed/harvest | scorecard |
|---|---|---|---|---|---|
| run1 | 1 | 1 | 1 | 1/1 | pass · 231k tok · $0.46 · 136s · 48 steps |
| run2 | 1 | 1 | 1 | 1/1 | pass · 271k tok · $0.54 · 172s · 55 steps |
| run3 | 1 | 1 | 1 | 1/1 | pass · 230k tok · $0.46 · 136s · 47 steps |

**Verdict: PASS × 3** (full checklist every run).

## Delivery markers (all runs)

- force_artifact: 0
- stale_watchdog: ≥1 each
- done_gate: 0

## Note on prior FAIL

An earlier same-day single run failed only on `junk/build removed` due to seatbelt path mismatch (EPERM after approval). That FAIL is **not** the preprint claim; this pass@3 (post-fix) replaces it. See `pass3-summary.json`.
