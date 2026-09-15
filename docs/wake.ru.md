# Закон wake

**Русский** · [English](wake.md)

Агент **не** думает в фоне. Он ставит **wake**; ядро доставляет; обычный ход продолжается.

> Ставится редко → tick / exit процесса будит → observe → act → review.

## Зачем

`process_spawn` уже гоняет долгие команды, но модель должна поллить. Не было прочного «продолжи позже» для exit, паттерна в логах или wall-clock.

## Виды

| Kind | Инструмент | Когда срабатывает |
|---|---|---|
| `process_exit` | `wake_when_process on=exit` | процесс вышел из `running` |
| `process_log` | `wake_when_process on=log` | логи содержат match / `/regex/i` |
| `defer` / `at` | `wake_at afterMs` / `at` | время |
| `interval` | `wake_at everyMs` | повтор (мин. 5м); перезаряжается |

Хранение в теле: `wake/<agentId>` (JSON). Лимиты: 8 armed, `afterMs ≥ 15s`, `everyMs ∈ [5m, 24h]`.

## Tools

- `wake_when_process` — следить за id из `process_spawn`  
- `wake_at` — `afterMs` | `at` (ISO) | `everyMs`  
- `wake_list` / `wake_cancel`

## Доставка

1. `ProcessTable.onSettled` и таймер 15с → `Kernel.deliverWakes`  
2. Due wake пишет system в run  
3. Если шаг не идёт — `SessionService.prompt` с `wakePrompt(...)`  
4. Interval перезаряжается; остальные → `fired`

Idle psyche / agenda отдельно: wake — **отложение сессии**, не drill автономии.

## Не делаем

- Вечный LLM-цикл в фоне  
- Свободный cron DSL  
- Смешение agenda gaps с расписанием оператора  

Код: `src/application/autonomy/wake.ts`, `runWakeTool.ts`, `Kernel.deliverWakes`.

К [оглавлению](README.ru.md).
