# Eval-прогоны

**Русский** · [English](evals.md)

Как запускать оценочные наборы. Ядро в `src/`, адаптеры в `evals/`. Секреты — в `evals/**/.env` (не в git).

| Набор | Для чего | LLM | Docker |
|---|---|---|---|
| [Four-hand](#1-four-hand) | `transfer_success_lift` — train → сдвинутый тест vs fresh | да | нет |
| [Spaced / transfer](#2-spaced-и-transfer) | Сводка уже собранных lift | нет | нет |
| [Юнит-тесты](#3-юнит-тесты) | Верификаторы и разбор model-строк | нет | нет |
| [Harbor](#4-harbor-terminal-bench) | Success на Terminal-Bench в Docker | да | да |
| [Live-learn](#5-live-learn) | Два хода на одном теле | да | нет |

Harbor считает success задачи. Опыт тела — four-hand (см. [Опыт](experience.ru.md)).

---

## Общие требования

```bash
git clone https://github.com/sergey-show/barney.git
cd barney
bun install
```

Для прогонов с моделью — OpenAI-совместимый endpoint (локальный Ollama достаточно):

```bash
export BARNEY_ABLATION_HOST=http://127.0.0.1:11434/v1
export BARNEY_ABLATION_MODEL=qwen3.8:latest
```

---

## 1. Four-hand

Четыре руки на кейс:

1. `kernel-train` — уроки в тело  
2. `kernel-test` — то же тело, сдвинутый тест  
3. `no-kernel` — та же модель без тела  
4. `kernel-fresh` — ядро, пустое тело  

`transfer_success_lift = pass(kernel-test) − pass(kernel-fresh)`.  
`recall_helped` на test: прошёл ∧ fresh упал ∧ recall использовали.

Кейсы (`HARD_TRANSFER_CASES`):

| Id | Train | Почему жёстко |
|---|---|---|
| `house-redact` | токены `<barney-redact-…>` | в тесте токены не названы |
| `house-merge` | JSON-канон (2 пробела, sorted keys, newline) | тест говорит только «house canon» |

```bash
BARNEY_ABLATION_HOST=http://127.0.0.1:11434/v1 \
BARNEY_ABLATION_MODEL=qwen3.8:latest \
bun run src/presentation/cli/main.ts eval experience --out ./tmp/fourhand-proof
```

Один кейс: `barney eval experience --case house-redact --out ./tmp/fourhand-redact`.

Выход: `fourhand-report.json` и вердикт в консоли. Пример: [proof/2026-09-15-fourhand-qwen38](proof/2026-09-15-fourhand-qwen38/). На локальной ~27B оба кейса — порядка десятков минут.

---

## 2. Spaced и transfer

Без модели — сводят JSON:

```bash
barney eval spaced path/to/observations.json
barney eval transfer path/to/observations.json
```

Формат spaced: `{ caseId, delayHours, transferSuccessLift }[]`.  
Immediate уже в four-hand; +24h / +7d — отдельные прогоны на том же теле.

---

## 3. Юнит-тесты

```bash
bun test src/application/evaluation/fourHandCurriculum.test.ts
bun test evals/harbor/run.test.ts
bun test src/application/evaluation
bun test src/application/experience
```

---

## 4. Harbor / Terminal-Bench

Success на задачах Terminal-Bench в Docker.

| Путь | Роль |
|---|---|
| `evals/harbor/barney_agent.py` | адаптер Harbor |
| `evals/harbor/run.ts` | one-shot в контейнере задачи |
| `evals/harbor/run_harbor.py` | CLI (+ fix bind-path на macOS, `.env`) |
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

Нужны Docker, сеть и модель на `OPENAI_BASE_URL`. Результаты в `jobs/` (gitignore).

---

## 5. Live-learn

Одно тело, два хода: сначала `openssl` на `PATH` всегда падает, потом «напиши скрипт и запусти».

```bash
bun evals/live-learn.ts --model ollama/qwen3.8:latest
```

[Опыт](experience.ru.md) · [Документация](README.ru.md).
