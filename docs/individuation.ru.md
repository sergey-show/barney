# Закон индивидуации

**Русский** · [English](individuation.md)

Self — не два лога успех/провал. Индивидуация — постоянная интеграция **Света** (доказанный спектр) и **Тени** (отказы, неиспользованное, пределы, слепые зоны) в pre-act appraisal, который выбирает путь.

> В Свет только то, что подкреплено evidence.  
> Тень типизирована, с лимитом и prune.  
> Appraisal детерминирован — не LLM-психолог.  
> Capability / skills — канон статистики; Samost — проекция.

## Определения

| Полюс | Смысл | Не это |
|---|---|---|
| **Свет** | Спектр, которым тело готово действовать (`skill` / `method` / `tooling` / `domain`) | Дневник побед |
| **Тень** | Архив `fail` / `rejected` / `unused` / `limit` / `blind` | Только ошибки чата |
| **Appraisal** | `competent \| partial \| blind \| constrained` → `act \| study \| self_run \| fork \| park` | Догадка планировщика |

## Гейты (анти-паттерны)

| Риск | Гейт |
|---|---|
| Раздувание Тени | Cap 12/kind, 40 total; `rejected` только при смене path; plastic prune |
| Самопиар Света | Нужны `refs` + exam/helped/transfer; study_write ≠ Light |
| LLM-appraisal | Чистая функция + таблица; тесты без модели |
| Двойной учёт | Capability = канон; Light/Shadow = проекция |
| Short-chat | Приветствия без appraisal/study |

## Код

`src/application/psyche/individuation.ts` · проводка в `DriveSolve` / `Kernel` · `SolvePolicy.onBlind|onConstrained|onConflict`

Связь: [Опыт](experience.ru.md) · [Автономия](autonomy.ru.md) · [Пластичность](plasticity.ru.md)

К [оглавлению](README.ru.md).
