# Инструменты

**Русский** · [English](tools.md)

Tools — это протокол ядра. Модель их не выдумывает: код даёт фиксированный набор, выполняет вызов и **сверяет** результат до следующего шага.

Плагины и MCP наращивают способность **вокруг** этого набора. Они его не подменяют.

## Семейства

На полном ходе у агента есть такие группы:

| Семейство | Tools | Для чего |
|---|---|---|
| Файлы | `fs_list`, `fs_stat`, `fs_read`, `fs_write`, `fs_edit`, `fs_append`, `fs_mkdir`, `fs_search`, `fs_remove`, `fs_restore` | Файлы worktree. Для правок лучше это, а не shell. |
| Shell | `shell` | Одна команда в worktree, до 120 с. |
| Процесс | `process_spawn`, `process_list`, `process_logs`, `process_kill` | Долгие сборки и серверы. |
| Поиск | `web_search` | Публичный веб. Затем открыть источники в браузере. |
| Браузер | `browser_open`, `browser_read`, `browser_screenshot`, `browser_show`, `browser_click`, `browser_fill`, `browser_press`, `browser_scroll` | Скрытая страница. `browser_show` только если оператор просил показать. |
| Плагины | `plugin_list`, `plugin_read`, `plugin_write`, `plugin_open` | Навыки и UI тела. См. [Плагины](plugins.ru.md). |
| MCP | `mcp_list`, `mcp_write`, `mcp_start`, `mcp_call`, `mcp_stop` | Локальные MCP-серверы. См. [MCP](mcp.ru.md). |
| Память | `memory_search`, `memory_write`, `memory_read`, `board_read`, `board_write` | Общие заметки и доска сессии. |
| Команда | `plan_set`, `agent_list`, `agent_spawn`, `agent_delegate` | Специалисты. Вложенный агент дальше не спавнит. |
| Самость | `self_status`, `self_log`, `self_commit`, `self_rollback` | Git `~/.barney`, не ядро. |

Алиасы `skill_*` для plugin-tools ещё работают.

У делегированного специалиста тот же набор **кроме** `agent_spawn`, `agent_delegate`, `plan_set` и `self_rollback`.

## Worktree и пути снаружи

`fs_*` и `shell` работают в worktree сессии (проект оператора или папка в `~/.barney/worktrees`).

Путь вне worktree закрыт, пока оператор не разрешит префикс:

- Web: **Allow**
- CLI: `/allow /path/prefix`
- Eval: `BARNEY_AUTO_APPROVE_OUTSIDE=1`

Исходники ядра (`src/`, `DriveSolve.ts`, `Kernel.ts`) переписать нельзя. Это физический запрет, не подсказка в промпте.

## Секреты и сверка

Секреты в выводе tools становятся `DETECTED_SECRET_<KIND>_<HASH>`. В `fs_edit` / `sed` нужен **полный токен**. Поиск по буквам `DETECTED_SECRET` живые секреты на диске не найдёт.

Тот же провалившийся вызов блокируется. Семейство, которое упало дважды, насыщается: надо сменить семейство, а не долбить тот же tool.

`fs_restore` возвращает последнюю удачную версию файла в этой сессии после плохой записи.

## Короткие ходы

Приветствие и «кто ты» могут обойтись без tools. Всё, где нужен файл, shell, браузер, плагин или факт о мире, идёт полным циклом: план → инструмент → сверка → ревью.

Оглавление: [Документация](README.ru.md).
