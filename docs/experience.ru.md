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

Не каждый PASS пишет skill. Не каждый FAIL пишет rule.

| Исход | Запись |
|---|---|
| PASS + failed path → другой path → success | `skill_candidate` (quarantine) |
| FAIL + повтор / structural + конкретная директива | `failure_rule` |
| Иначе | `episode_only` (без pin в body) |

Код: `src/application/experience/experienceLayers.ts`.

## Обязательный pre-act recall

Перед act — три корзины:

1. **Shadow** — похожие fails  
2. **Rules** — директивы по failure-mode  
3. **Skills** — quarantine / verified / frozen  

И лог:

```text
recall_hit: 0/1
recall_used: 0/1   # plan/act/tools оставили отпечаток урока
recall_helped: 0/1 # корреляция до 4-hand; 1 только при hit+used+pass
```

Код: `src/application/experience/experienceRecall.ts` (проводка в `DriveSolve`).

## Четыре руки (hard transfer)

Дружелюбный suite, где оба armа 100%, **не измеряет** опыт.

Протокол:

1. sterile home  
2. **kernel-train** (писать уроки)  
3. **kernel-test** (то же body)  
4. **no-kernel** (та же модель, без body)  
5. **kernel-fresh** (полное ядро, пустое body)

Критерий опыта: **kernel-test > kernel-fresh** на сдвинутом тесте.

Сиды: `HARD_TRANSFER_CASES` в `src/application/evaluation/fourHandCurriculum.ts`  
(`sanitize-shifted`, `merge-shifted`).

## Метрики

| Метрика | Смысл |
|---|---|
| `transfer_success_lift` | pass rate test: kernel-with-train − kernel-fresh |
| `recall_hit_rate` | доля шагов с релевантным recall |
| `recall_used_rate` | доля, где plan/act реально откликнулся |
| `skill_reuse_rate` | verified skill на новой задаче |
| `false_skill_rate` | pinned skill, который не помог / мешал |
| `shadow_to_rule` | fails → rules, которые потом сработали |


К [оглавлению](README.ru.md).
