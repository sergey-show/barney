import type { WorkspacePort } from "../ports.ts";
import type { ToolCall } from "../../domain/tools/FileTools.ts";

export async function runFileTool(ws: WorkspacePort, call: ToolCall, signal?: AbortSignal): Promise<string> {
  const args = call.arguments ?? {};
  const str = (key: string) => String(args[key] ?? "");
  try {
    switch (call.name) {
      case "fs_list":
        return await ws.list(str("path") || ".");
      case "fs_stat":
        return await ws.stat(str("path"));
      case "fs_read":
        return await ws.read(str("path"));
      case "fs_write":
        return await ws.write(str("path"), str("content"));
      case "fs_edit":
        return await ws.edit(str("path"), str("old"), str("new"));
      case "fs_append":
        return await ws.append(str("path"), str("content"));
      case "fs_mkdir":
        return await ws.mkdir(str("path"));
      case "fs_search":
        return await ws.search(str("query"), str("path") || ".");
      case "grep":
        if (!ws.grep) return "error: grep not supported on this workspace";
        return await ws.grep(str("pattern"), str("path") || ".", str("include") || undefined);
      case "glob":
        if (!ws.glob) return "error: glob not supported on this workspace";
        return await ws.glob(str("pattern"), str("path") || ".");
      case "patch":
        if (!ws.patch) return "error: patch not supported on this workspace";
        return await ws.patch(str("patchText"));
      case "fs_remove":
        return await ws.remove(str("path"));
      case "shell":
        return await ws.shell(str("command"), signal);
      default:
        return `unknown tool: ${call.name}`;
    }
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
