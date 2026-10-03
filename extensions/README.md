# IDE extensions (ACP one-click)

Barney already speaks **ACP v1** over stdio (`barney acp` / `barney-agent`).
These packages wire that into editors without hand-rolled JSON-RPC.

| Path | Editor | What it does |
|---|---|---|
| [`vscode/`](vscode/) | VS Code (+ Cursor can load VSIX) | Extension that registers Barney in `acp.agents` and verifies `barney-agent` on PATH |
| [`cursor/`](cursor/) | Cursor | Drop-in settings snippet + install script |

## Prerequisites

```bash
npm i -g @encsch/barney   # or: bun install && bun link from this repo
which barney-agent        # must resolve
```

## Quick paths

**Cursor**

```bash
./extensions/cursor/install.sh
# or merge extensions/cursor/settings.snippet.json into Cursor User Settings
```

**VS Code**

```bash
cd extensions/vscode
npm install
npm run package          # writes barney-acp-*.vsix
code --install-extension barney-acp-*.vsix
```

Then Command Palette → **Barney: Verify ACP agent** → start a chat with your ACP client using agent id `barney`.

Protocol details: repo root [README.md](../README.md#acp).
