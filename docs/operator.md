# Operator guide

**English** · How Self, board, oracle, and PE show up while you work.

## Surfaces

| Surface | What you see |
|---|---|
| Web **Self** pane | Compass, light/shadow, **task board**, existence, episodes (+ next hint) |
| Chat chips | Latest `oracle:` / `prediction_error:` from the transcript |
| CLI `/status` | Status + last oracle/PE lines |
| CLI `/self` | Board, existence, compass, last episode hint |

## Soft vs DevOps

- **DevOps**: byte evidence + structural Review. Soft matrix is **not** invented from bare `soft_*` tokens.
- **Soft**: declare ```expectation JSON```. `OraclePort` owns `outcomeOk`. Failures reopen the same-turn persist loop.

## Harbor

- `BARNEY_HARBOR_TIMEOUT_MS` (default `600000`) → `AbortSignal.timeout`
- `BARNEY_HARBOR_MAX_ATTEMPTS` (default `24`)
- `BARNEY_SPI_AFFECTS_OUTCOME=1` → SPI verify can clear `outcomeOk`

## Related

`docs/oracle.md` · `docs/spi.md`
