# Evals

[docs/evals.md](../docs/evals.md) · [Русский](../docs/evals.ru.md)

| Path | What |
|---|---|
| `barney eval experience` | four-hand (code in `src/`) |
| `harbor/` | Terminal-Bench adapter, `.env.example` |
| `live-learn.ts` | two turns, one body |
| `live-harness.ts` | approval ladder + flag (`house-harness-flag`) |
| `harbor/run.test.ts` | model-string unit tests |

```bash
cp evals/harbor/.env.example evals/harbor/.env

BARNEY_ABLATION_HOST=http://127.0.0.1:11434/v1 \
BARNEY_ABLATION_MODEL=qwen3.8:latest \
bun run src/presentation/cli/main.ts eval experience --out ./tmp/fourhand-proof

# Harness live probe (approval + rm -rf + flag)
bun evals/live-harness.ts --model ollama/qwen3.8:27b-mlx --out ./tmp/harness-proof
```

`evals/**/.env` and `jobs/` stay local.
