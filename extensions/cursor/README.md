# Barney ACP (Cursor)

One-click wiring for Cursor using the same `barney-agent` stdio ACP server.

## Install

```bash
chmod +x ./install.sh
./install.sh
```

Or manually merge [`settings.snippet.json`](settings.snippet.json) into **Cursor Settings → Open User Settings (JSON)**.

If you use an ACP client extension inside Cursor, select agent **`barney`**.

## Verify

```bash
barney-agent   # should wait on stdio (Ctrl+C to stop)
# or from repo:
bun run acp
```

No hand-written JSON-RPC required — the extension/settings only point at the binary.
