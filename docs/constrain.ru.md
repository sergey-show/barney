# Constrain (песочница)

**Русский** · [English](constrain.md)

Shell-инструменты по возможности запускаются в OS-песочнице. Это снижает риск
от галлюцинированного `rm` / записи — но **не** формальная security boundary и
не «абсолютная» изоляция.

## По умолчанию

| Платформа | Инструмент | Политика |
|---|---|---|
| macOS | `sandbox-exec` | Deny default; write только в `cwd` сессии |
| Linux | `bwrap` | read-only `/`, writable `cwd`, unshare pid/ipc/uts, `--cap-drop ALL` |
| Нет инструмента | passthrough | Команда без обёртки |

Код: `src/infrastructure/sandbox/OsSandbox.ts`.

## Опциональный Docker

См. [`deploy/docker/sandbox/`](../deploy/docker/sandbox/README.md).
