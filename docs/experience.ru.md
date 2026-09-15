# Закон опыта

**Русский** · [English](experience.md)

Закон петли у Барни уже измерим. Опыт реален только когда он **узкий, принудительно вспоминается и проверяется на новой задаче**.

> Урок пишется редко, поднимается обязательно, проверяется на сдвинутой задаче, иначе выкидывается.

Marker lift доказывает **петлю**.  
`transfer_success_lift = pass(kernel-test) − pass(kernel-fresh)` доказывает **опыт**.

## Три слоя (мерить отдельно)

| Слой | Что это | Когда помогает |
|---|---|---|
| **Episode fact** | «на этой задаче сработало X» | тот же goal |
| **Failure rule** | «при ошибке F не делай A, делай B» | похожий failure-mode |
| **Skill** | переиспользуемый путь действия | другой task class (transfer) |

Не каждый PASS пишет skill. Не каждый FAIL пишет rule. Pin предпочитает **prediction error**.

| Исход | Запись |
|---|---|
| PASS + failed path → другой path → success + PE | `skill_candidate` (quarantine; может нести `procedure`) |
| FAIL + PE + повтор/structural + конкретная директива | `failure_rule` |
| PASS + house convention pin | `lesson_pin` |
| Иначе | `episode_only` (без pin в body) |

Код: `experienceLayers.ts`, `predictionError.ts`.

## Обязательный pre-act recall

Перед act — корзины, ранжированные **weight × similarity**:

1. **Shadow** — похожие fails  
2. **Rules** — директивы по failure-mode  
3. **Skills** — quarantine / verified / frozen (в т.ч. procedure)  

И лог:

```text
recall_hit: 0/1
recall_used: 0/1   # plan/act/tools оставили отпечаток урока
recall_helped: 0/1/?  # только каузально (four-hand); не из pass alone
```

Код: `experienceRecall.ts`, `weightedRecall.ts` (проводка в `DriveSolve`).

## Четыре руки (hard transfer)

Дружелюбный suite, где оба armа 100%, **не измеряет** опыт.

Протокол:

1. sterile home  
2. **kernel-train** (писать уроки)  
3. **kernel-test** (то же body)  
4. **no-kernel** (та же модель, без body)  
5. **kernel-fresh** (полное ядро, пустое body)

Критерий опыта: **kernel-test > kernel-fresh** на сдвинутом тесте.  
Каузальный `recall_helped` на kernel-test: **pass ∧ fresh fail ∧ recall_used**.

Сиды: `HARD_TRANSFER_CASES` (`house-redact`, `house-merge`).

Spaced retention (immediate / +1d / +7d): `spacedTransfer.ts`.  
Immediate — в four-hand отчёте; позже: `barney eval spaced <observations.json>`.

## Dream consolidation

Idle dream compress мержит похожие failure rules (`mergeFailureRules`).

## Метрики

| Метрика | Смысл |
|---|---|
| `transfer_success_lift` | pass rate test: kernel-with-train − kernel-fresh |
| `recall_hit_rate` | доля шагов с релевантным recall |
| `recall_used_rate` | доля, где plan/act реально откликнулся |
| `recall_helped` | только каузально (four-hand) |
| `spaced retention` | lift по задержкам (`retains` / `fades`) |
| `skill_reuse_rate` | verified skill на новой задаче |
| `false_skill_rate` | pinned skill, который не помог / мешал |
| `shadow_to_rule` | fails → rules, которые потом сработали |

## Стык с fayr

См. [plasticity.ru.md](plasticity.ru.md) и `bio/fayr.md`.


К [оглавлению](README.ru.md).
