import * as vscode from "vscode";
import { spawnSync } from "node:child_process";

const SNIPPET = `{
  "acp.agents": {
    "barney": {
      "command": "barney-agent",
      "args": [],
      "env": {}
    }
  }
}`;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("barney.acp.verify", async () => {
      const command = vscode.workspace.getConfiguration("barney.acp").get<string>("command") || "barney-agent";
      const probe = spawnSync(command, ["--help"], { encoding: "utf8", timeout: 8000 });
      // barney-agent injects `acp` and may not support --help; also try bare spawn with timeout kill
      const which = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
        encoding: "utf8",
      });
      if (which.status === 0 && (which.stdout || "").trim()) {
        void vscode.window.showInformationMessage(
          `Barney ACP ready: ${command} → ${(which.stdout || "").trim()}`,
        );
        return;
      }
      if (probe.error) {
        void vscode.window.showErrorMessage(
          `Barney ACP: cannot find "${command}" on PATH. Install @encsch/barney or bun link this repo.`,
        );
        return;
      }
      void vscode.window.showInformationMessage(`Barney ACP: "${command}" is callable.`);
    }),
    vscode.commands.registerCommand("barney.acp.copyConfig", async () => {
      await vscode.env.clipboard.writeText(SNIPPET);
      void vscode.window.showInformationMessage("Copied ACP settings snippet for Barney.");
    }),
  );
}

export function deactivate(): void {}
