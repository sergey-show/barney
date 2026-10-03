# SPI (body providers)

**English** · [Русский](spi.ru.md)

Barney stays philosophical by keeping an **immutable Core** and growing only through the **body**. SPI is how the body plugs into **stable kernel ports** without rewriting `src/`.

```
Immune Core          Plastic Body
─────────────        ─────────────────────────
Port contracts  ←——  ~/.barney/providers/<name>/
Turn / invent law    provider.json + verify.sh
No agent JS load     quarantine → exam → activate
```

Prefer **skill/plugin** first. Use SPI when you need a repeatable **port implementation** (pilot: `verify`). Prefer SPI over inventing MCP when a local shell check is enough.

## Ports (kernel-owned)

| Port | Purpose | Invoke (v1) |
|---|---|---|
| `verify` | Soft worktree check after Review / via tools | `shell` script under OS sandbox |

New ports require a **human release** in the kernel. Agents cannot invent port ids.

## Layout

```
~/.barney/providers/<name>/
  provider.json
  verify.sh          # for port=verify, invoke.kind=shell
```

`provider.json`:

```json
{
  "name": "house-token-check",
  "version": "1",
  "port": "verify",
  "apiVersion": 1,
  "status": "quarantine",
  "description": "Fail if house redact tokens missing",
  "invoke": { "kind": "shell", "command": "./verify.sh", "timeoutSec": 30 },
  "wins": 0,
  "transfers": 0,
  "fails": 0
}
```

## Lifecycle

1. `provider_list` — invent gate requires this before write.
2. `provider_write` — body only; starts **quarantine** (not auto-run).
3. `provider_exam` — run script; success + transfer shortcut → **verified/frozen**.
4. Active (`verified`|`frozen`) providers may run on `provider_verify` and as **soft** `spi_verify:` lines after Review (observation only — Review verdict unchanged).
5. **Frozen** providers: invoke/port rewrite blocked.

Env for shell verify: `BARNEY_SPI_PROVIDER`, `BARNEY_SPI_PORT`, `BARNEY_SPI_GOAL`, `BARNEY_SPI_WORKTREE`.

## Tools

| Tool | Role |
|---|---|
| `provider_list` | Catalog |
| `provider_read` | Read files |
| `provider_write` | Create/update (gated) |
| `provider_exam` | Graduate quarantine |
| `provider_verify` | Run active providers |

## Safety

- No dynamic `import()` of agent-authored JS into the kernel process.
- Shell invoke uses [Constrain](constrain.md) when available.
- Capability invent law: list → (research for MCP) → write. SPI local write allowed after `provider_list` like plugins.

Index: [Docs](README.md) · [Plugins](plugins.md) · [MCP](mcp.md).
