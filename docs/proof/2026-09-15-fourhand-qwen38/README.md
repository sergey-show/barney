# Four-hand · 2026-09-15

`house-redact` + `house-merge`, model `qwen3.8:latest`, ~49 min.

## Command

```bash
BARNEY_ABLATION_HOST=http://127.0.0.1:11434/v1 \
BARNEY_ABLATION_MODEL=qwen3.8:latest \
barney eval experience --out ./tmp/fourhand-proof
```

| | |
|---|---|
| Model | `qwen3.8:latest` |
| Host | `http://127.0.0.1:11434/v1` |
| Report | [`fourhand-report.json`](./fourhand-report.json) |
| Log | [`run.log`](./run.log) |

## Result

| | kernel-test | no-kernel | kernel-fresh | lift | recall_helped | kernelLift |
|---|---|---|---|---|---|---|
| `house-redact` | PASS | FAIL | FAIL | 1 | 1 | 0 |
| `house-merge` | PASS | FAIL | FAIL | 1 | 1 | 0 |

Verdict `experience_helps`. Mean `transfer_success_lift` 1.00.  
`skillReuseRate: 0`. Spaced: only `delayHours: 0` (inconclusive for +24h / +7d).

Fresh had `recallHit` / `recallUsed` on both cases but still failed — without the train convention the trail did not land the house tokens / merge bytes.

## Files

- [`fourhand-report.json`](./fourhand-report.json)
- [`house-redact.json`](./house-redact.json)
- [`house-merge.json`](./house-merge.json)

Law: [experience.md](../../experience.md). How to re-run: [evals.md](../../evals.md).
