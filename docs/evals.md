# Evals

**English** · [Русский](evals.ru.md)

How to run the evaluation suites. Kernel in `src/`, adapters in `evals/`. Secrets in `evals/**/.env` (not in git).

| Suite | For | LLM | Docker |
|---|---|---|---|
| [Four-hand](#1-four-hand) | `transfer_success_lift` — train → shifted test vs fresh | yes | no |
| [Spaced / transfer](#2-spaced-and-transfer) | Summarize lifts you already saved | no | no |
| [Unit tests](#3-unit-tests) | Verifiers and model-string parsing | no | no |
| [Harbor](#4-harbor-terminal-bench) | Terminal-Bench success in Docker | yes | yes |
| [Live-learn](#5-live-learn) | Two turns on one body | yes | no |

Harbor scores task success. Body experience is four-hand (see [Experience](experience.md)).

---

## Prerequisites

```bash
git clone https://github.com/sergey-show/barney.git
cd barney
bun install
```

For LLM runs, an OpenAI-compatible endpoint (local Ollama is enough):

```bash
export BARNEY_ABLATION_HOST=http://127.0.0.1:11434/v1
export BARNEY_ABLATION_MODEL=qwen3.8:latest
```

---

## 1. Four-hand

Four arms per case:

1. `kernel-train` — write lessons into a body  
2. `kernel-test` — same body, shifted test  
3. `no-kernel` — same model, no body  
4. `kernel-fresh` — kernel, empty body  

`transfer_success_lift = pass(kernel-test) − pass(kernel-fresh)`.  
`recall_helped` on test: pass ∧ fresh fail ∧ recall used.

Cases (`HARD_TRANSFER_CASES`):

| Id | Train | Why hard |
|---|---|---|
| `house-redact` | `<barney-redact-…>` tokens | test never names the tokens |
| `house-merge` | JSON canon (2-space, sorted keys, newline) | test only says “house canon” |

```bash
BARNEY_ABLATION_HOST=http://127.0.0.1:11434/v1 \
BARNEY_ABLATION_MODEL=qwen3.8:latest \
bun run src/presentation/cli/main.ts eval experience --out ./tmp/fourhand-proof
```

One case: `barney eval experience --case house-redact --out ./tmp/fourhand-redact`.

Output: `fourhand-report.json` and a console verdict. Example: [proof/2026-09-15-fourhand-qwen38](proof/2026-09-15-fourhand-qwen38/). On a local ~27B both cases take on the order of tens of minutes.

---

## 2. Spaced and transfer

No live model — they fold JSON you already have:

```bash
barney eval spaced path/to/observations.json
barney eval transfer path/to/observations.json
```

Spaced shape: `{ caseId, delayHours, transferSuccessLift }[]`.  
Immediate is already in four-hand; +24h / +7d need separate runs on the same body.

---

## 3. Unit tests

```bash
bun test src/application/evaluation/fourHandCurriculum.test.ts
bun test evals/harbor/run.test.ts
bun test src/application/evaluation
bun test src/application/experience
```

---

## 4. Harbor / Terminal-Bench

Task success on Terminal-Bench in Docker.

| Path | Role |
|---|---|
| `evals/harbor/barney_agent.py` | Harbor adapter |
| `evals/harbor/run.ts` | one-shot inside the task container |
| `evals/harbor/run_harbor.py` | CLI (macOS bind-path fix + `.env`) |
| `evals/harbor/settings.py` | pydantic-settings |
| `evals/harbor/.env.example` | → `.env` |

```bash
cd evals/harbor
python3 -m pip install -r requirements.txt
cp .env.example .env
```

```bash
python3 evals/harbor/run_harbor.py run \
  -d terminal-bench/terminal-bench-2-1 \
  -a evals.harbor.barney_agent:Barney \
  -m 'ollama/qwen3.8:latest' \
  -i terminal-bench/fix-git \
  -i terminal-bench/openssl-selfsigned-cert \
  -n 1 -k 1 -y \
  --timeout-multiplier 3 \
  -o jobs/harbor-smoke
```

Needs Docker, network, and a model at `OPENAI_BASE_URL`. Outputs under `jobs/` (gitignored).

---

## 5. Live-learn

One body, two turns: first, `openssl` on `PATH` always fails; then “write a script and run it”.

```bash
bun evals/live-learn.ts --model ollama/qwen3.8:latest
```

[Experience](experience.md) · [Docs](README.md).
