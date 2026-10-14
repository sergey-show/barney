#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SNIPPET="$(cd "$(dirname "$0")" && pwd)/settings.snippet.json"

if ! command -v barney-agent >/dev/null 2>&1; then
  echo "barney-agent not on PATH."
  echo "From repo: cd \"$ROOT\" && bun link"
  echo "Or: npm i -g @encsch/barney"
  exit 1
fi

echo "Barney ACP binary: $(command -v barney-agent)"
echo
echo "Merge this into Cursor Settings (JSON):"
echo "--------------------------------------"
cat "$SNIPPET"
echo "--------------------------------------"
echo
echo "Optional: install the VS Code VSIX (Cursor accepts it):"
echo "  cd \"$ROOT/extensions/vscode\" && npm install && npm run package"
echo "  Then Cursor → Extensions → Install from VSIX"
echo
echo "Done. Pick agent id 'barney' in your ACP client panel."
