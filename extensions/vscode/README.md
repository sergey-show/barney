# Barney ACP (VS Code)

Registers Barney as an ACP stdio agent (`barney-agent`) for VS Code ACP clients
(e.g. [ACP Client](https://marketplace.visualstudio.com/items?itemName=formulahendry.acp-client)).

## Install

1. `npm i -g @encsch/barney` (or build/link from the monorepo)
2. From this folder:

```bash
npm install
npm run package
code --install-extension barney-acp-*.vsix
```

3. Command Palette → **Barney: Verify ACP agent**
4. In your ACP client, select agent **barney**

## Settings

- `barney.acp.command` — default `barney-agent`
- `acp.agents.barney` — `{ command, args, env }` for ACP Client compatible extensions

No manual JSON-RPC wiring required.
