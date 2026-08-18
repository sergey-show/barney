import type { HomeRepoPort } from "../ports.ts";
import type { ToolCall } from "../../domain/tools/FileTools.ts";

export async function runSelfTool(home: HomeRepoPort, call: ToolCall): Promise<string> {
  const args = call.arguments ?? {};
  const str = (key: string) => String(args[key] ?? "").trim();
  try {
    switch (call.name) {
      case "self_status":
        return await home.status();
      case "self_log":
        return await home.log(Number(args.limit) || 12);
      case "self_commit":
        return await home.commit(str("message") || "become");
      case "self_rollback": {
        const rev = str("rev") || str("revision");
        if (!rev) return "error: rev is required (commit sha or HEAD~1)";
        return await home.rollback(rev);
      }
      default:
        return `unknown tool: ${call.name}`;
    }
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
