# Закон автономии

**Русский** · [English](autonomy.md)

Самообучение ≠ автономия. Автономии нужна **узкая повестка**, которая может стартовать работу без запроса оператора.

> Пункт повестки пишется редко (из повторных дыр),  
> поднимается в idle как self-run,  
> проверяется тем же review,  
> иначе выкидывается.

## Три слоя

| Слой | Что | Откуда |
|---|---|---|
| **Gap** | Повторный fail / backlog | episodes + backlog |
| **Agenda item** | Локальный drill + причина | `proposeAgendaItem` |
| **Self-run** | `createRun` из idle | Kernel `tick` → `self_run` |

Код: `src/application/autonomy/agenda.ts`, idle в `idleTick.ts` / `Kernel.tick`.

## Ограничения

- Design sealed до study/self-run  
- Нет self-run при открытой сессии оператора  
- Cooldown после self-run  
- Лимит pending; один class за раз  
- Drill — локальный файл (`recovery-<class>.md`), не open-world  
- По-прежнему: не писать оператору первым из idle  

## Связь с опытом

Автономия на декоративной памяти вредна. Порядок:

1. Hard transfer lift — [Опыт](experience.ru.md)  
2. Повестка из реальных gaps  
3. Capability map / decay позже  

## Порядок idle

`seed_samost` → board → dream → absorb_shadow → **self_run** → study  

К [оглавлению](README.ru.md).
