/**
 * Capability discovery law (kernel-hard):
 * list body → search evidence → reuse if present → only then invent (write).
 * Prompt text is advisory; this gate is physical.
 */

export type DiscoverLedger = {
  listedBody: boolean;
  researched: boolean;
  /** Tool names observed this run (for tests / debug). */
  seen: string[];
};

export function emptyDiscoverLedger(): DiscoverLedger {
  return { listedBody: false, researched: false, seen: [] };
}

const LIST_TOOLS = new Set([
  "mcp_list",
  "plugin_list",
  "skill_list",
]);

const RESEARCH_TOOLS = new Set([
  "web_search",
  "browser_open",
  "browser_navigate",
]);

/** MCP servers that count as docs research when called. */
const RESEARCH_MCP = /^(?:context7|docs?|documentation)$/i;

export function noteDiscoverTool(
  ledger: DiscoverLedger,
  toolName: string,
  args?: Record<string, unknown>,
): void {
  if (!ledger.seen.includes(toolName)) ledger.seen.push(toolName);
  if (LIST_TOOLS.has(toolName)) ledger.listedBody = true;
  if (RESEARCH_TOOLS.has(toolName)) ledger.researched = true;
  if (toolName === "mcp_call") {
    const server = String(args?.server ?? args?.name ?? "");
    if (RESEARCH_MCP.test(server)) ledger.researched = true;
  }
}

/** Rebuild ledger from run console transcript (survives act rounds). */
export function discoverLedgerFromTranscript(
  lines: Array<{ kind: string; text: string }>,
): DiscoverLedger {
  const ledger = emptyDiscoverLedger();
  for (const item of lines) {
    if (item.kind === "research") {
      ledger.researched = true;
      continue;
    }
    if (item.kind !== "console" && item.kind !== "system") continue;
    const text = item.text;
    const tool = /^([a-z0-9_]+)\b/i.exec(text)?.[1]?.toLowerCase() ?? "";
    if (!tool) continue;
    let args: Record<string, unknown> | undefined;
    const jsonStart = text.indexOf("{");
    if (jsonStart >= 0) {
      const jsonEnd = text.indexOf("\n", jsonStart);
      const slice = text.slice(jsonStart, jsonEnd < 0 ? undefined : jsonEnd);
      try {
        args = JSON.parse(slice) as Record<string, unknown>;
      } catch {
        args = undefined;
      }
    }
    noteDiscoverTool(ledger, tool, args);
    if (/DeepResearch|research brief|Opened dump/i.test(text)) ledger.researched = true;
  }
  return ledger;
}

export type CapabilityWriteGate = {
  blocked: boolean;
  reason?: string;
};

/**
 * Gate mcp_write / plugin_write / skill_write for *new* body growth.
 * - Always require body list first (see what exists).
 * - New MCP recipes also require search evidence (no invented npx packages).
 * - Existing recipe/plugin on disk may update after list only.
 * - New local plugin/skill may write after list (prefer plugin over MCP).
 */
export function gateCapabilityWrite(input: {
  toolName: string;
  alreadyExists: boolean;
  ledger: DiscoverLedger;
}): CapabilityWriteGate {
  if (
    input.toolName !== "mcp_write"
    && input.toolName !== "plugin_write"
    && input.toolName !== "skill_write"
  ) {
    return { blocked: false };
  }

  if (!input.ledger.listedBody) {
    return {
      blocked: true,
      reason: [
        "BLOCKED by Self: capability invent.",
        "First mcp_list or plugin_list (see what already exists).",
        input.toolName === "mcp_write"
          ? "Then web_search or browser_open for the real package/docs. Only then mcp_write. Do not invent command/args."
          : "Then plugin_write / skill_write if nothing fits. Prefer an existing plugin over a new MCP.",
      ].join(" "),
    };
  }

  if (input.alreadyExists) return { blocked: false };

  // Local plugin/skill growth is allowed after list; MCP must show evidence.
  if (input.toolName !== "mcp_write") return { blocked: false };

  if (!input.ledger.researched) {
    return {
      blocked: true,
      reason: [
        "BLOCKED by Self: capability invent without evidence.",
        "Body list is done; now web_search or browser_open the official package/docs",
        "(or mcp_call context7 if that server is already running).",
        "Reuse a hit; only then write a new recipe. Do not invent npx packages.",
      ].join(" "),
    };
  }

  return { blocked: false };
}

export const CAPABILITY_LAW_LINE =
  "Capability law (code-enforced): mcp_list|plugin_list → web_search|browser_open → reuse if present → only then mcp_write|plugin_write. Do not invent recipes.";
