# Закон пластичности

**Русский** · [English](plasticity.md)

Ядро — неизменный ствол. **Кортикальная пластичность** живёт в теле: веса, прунинг, сон, env.

> Синапс усиливается, только если recall изменил исход.  
> Неиспользованное слабеет.  
> Конфликт — по utility (duel).  
> Структуру (ядро) меняет только релиз человека.

## Механизмы

| Механизм | Поведение |
|---|---|
| **Hebbian utility** | `strength + wins/transfers − fails − age` |
| **Реконсолидация** | При recall: used+pass ↑ · used+fail ↓ · ignore лёгкий ↓ |
| **Метапластика** | Давление записи от frustration/gaps — в тишине меньше rules |
| **Прунинг** | Низкий utility → archived в idle sleep |
| **Duel** | Два skill одного class+mode → побеждает utility |
| **Env** | Skill с чужим env не в recall |
| **Unfreeze** | Frozen с серией fails → verified |

Код: `src/application/plasticity/plasticity.ts`  
Idle: `plastic_sleep` (после dream, до absorb/self_run/study).

## Связь с другими законами

1. Петля — markers  
2. [Опыт](experience.ru.md) — редкая запись, recall, transfer lift  
3. [Автономия](autonomy.ru.md) — повестка  
4. **Пластичность** — усилить / забыть / консолидировать  

Без experience lift прунинг опасен. С lift — меньше «костылей».

## Стык с fayr

| Fayr | Код |
|---|---|
| Prediction error | `predictionError.ts` → write gate |
| Top-k weight × similarity | `weightedRecall.ts` |
| Procedural skill | `LessonTrail.procedure` |
| Dream merge | `mergeFailureRules` |
| Causal `recall_helped` | four-hand; не pass-alone |
| Spaced retention | `spacedTransfer.ts` |

К [оглавлению](README.ru.md).
