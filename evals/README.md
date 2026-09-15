# Evals

[docs/evals.md](../docs/evals.md) · [Русский](../docs/evals.ru.md)

| Path | What |
|---|---|
| `barney eval experience` | four-hand (code in `src/`) |
| `harbor/` | Terminal-Bench adapter, `.env.example` |
| `live-learn.ts` | two turns, one body |
| `harbor/run.test.ts` | model-string unit tests |

```bash
cp evals/harbor/.env.example evals/harbor/.env

BARNEY_ABLATION_HOST=http://127.0.0.1:11434/v1 \
BARNEY_ABLATION_MODEL=qwen3.8:latest \
bun run src/presentation/cli/main.ts eval experience --out ./tmp/fourhand-proof
```

`evals/**/.env` and `jobs/` stay local.
