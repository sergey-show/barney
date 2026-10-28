# Руководство оператора

**Русский** · Где видны Self, доска, oracle и PE.

## Поверхности

| Поверхность | Что видно |
|---|---|
| Web **Self** | Компас, light/shadow, **доска задачи**, existence, эпизоды (+ next hint) |
| Чипы в чате | Последние `oracle:` / `prediction_error:` |
| CLI `/status` | Статус + oracle/PE |
| CLI `/self` | Доска, existence, компас, hint эпизода |

## Soft vs DevOps

- **DevOps**: байты + structural Review. Матрица **не** выдумывается из голых `soft_*`.
- **Soft**: явный ```expectation JSON```. `OraclePort` владеет `outcomeOk`. Провал открывает тот же persist-цикл.

## Harbor

- `BARNEY_HARBOR_TIMEOUT_MS` (по умолчанию `600000`)
- `BARNEY_SPI_AFFECTS_OUTCOME=1` — SPI может сбросить `outcomeOk`

## См. также

`docs/oracle.md` · `docs/spi.md`
