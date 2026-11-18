/**
 * Approval ladder — escalate risky tools without defaulting to never-ask or always-ask.
 * Trusted prefixes and session grants widen agency; hard deny stays elsewhere.
 */

export type ApprovalMode = "unless_trusted" | "on_request" | "on_failure" | "never";

export type ApprovalRisk = "low" | "medium" | "high";

export type ApprovalDecision = "allow" | "deny" | "ask" | "trusted";

export type ApprovalVerdict = {
  decision: ApprovalDecision;
  reason: string;
  signature: string;
  risk: ApprovalRisk;
};

const HIGH_TOOLS = new Set([
  "shell",
  "process_spawn",
  "mcp_write",
  "plugin_write",
  "provider_write",
  "skill_write",
]);

const MEDIUM_TOOLS = new Set([
  "fs_write",
  "fs_edit",
  "fs_append",
  "patch",
  "process_kill",
  "mcp_start",
  "mcp_stop",
  "agent_spawn",
  "agent_delegate",
  "codemode",
]);

export function toolApprovalRisk(toolName: string, args?: Record<string, unknown>): ApprovalRisk {
  const name = toolName.trim();
  if (name === "shell" || name === "process_spawn") {
    const cmd = String(args?.command ?? args?.cmd ?? "");
    if (/\b(rm|mv|chmod|chown|curl|wget|dd)\b/i.test(cmd)) return "high";
    if (/\b(git\s+push|npm\s+publish|docker\s+rm)\b/i.test(cmd)) return "high";
    return "medium";
  }
  if (HIGH_TOOLS.has(name)) return "high";
  if (MEDIUM_TOOLS.has(name)) return "medium";
  return "low";
}

export function approvalSignature(toolName: string, args?: Record<string, unknown>): string {
  const name = toolName.trim();
  if (name === "shell" || name === "process_spawn") {
    const cmd = String(args?.command ?? args?.cmd ?? "").replace(/\s+/g, " ").trim();
    const prefix = cmd.split(" ").slice(0, 3).join(" ");
    return `${name}:${prefix || cmd.slice(0, 80)}`;
  }
  const path = String(args?.path ?? args?.name ?? "").trim();
  return path ? `${name}:${path}` : name;
}

export function decideApproval(input: {
  mode: ApprovalMode;
  toolName: string;
  args?: Record<string, unknown>;
  trustedPrefixes?: string[];
  sessionAllows?: Iterable<string>;
  sessionDenies?: Iterable<string>;
}): ApprovalVerdict {
  const risk = toolApprovalRisk(input.toolName, input.args);
  const signature = approvalSignature(input.toolName, input.args);
  const denies = new Set(input.sessionDenies ?? []);
  if (denies.has(signature) || denies.has(input.toolName)) {
    return { decision: "deny", reason: "session deny", signature, risk };
  }
  const allows = new Set(input.sessionAllows ?? []);
  if (allows.has(signature) || allows.has(input.toolName)) {
    return { decision: "allow", reason: "session allow", signature, risk };
  }
  if (input.mode === "never") {
    return { decision: "allow", reason: "approval mode never", signature, risk };
  }
  const trusted = (input.trustedPrefixes ?? []).some((prefix) => signatureMatchesPrefix(signature, prefix));
  if (trusted) {
    return { decision: "trusted", reason: "trusted prefix", signature, risk };
  }
  if (input.mode === "on_failure") {
    if (risk === "high") {
      return { decision: "ask", reason: "high risk under on_failure", signature, risk };
    }
    return { decision: "allow", reason: "on_failure defers medium/low", signature, risk };
  }
  if (input.mode === "unless_trusted") {
    // Medium stays autonomous under sandbox + hard deny; only high escalates.
    if (risk === "high") {
      return { decision: "ask", reason: "untrusted high risk", signature, risk };
    }
    return { decision: "allow", reason: "trusted-or-low/medium", signature, risk };
  }
  // on_request
  if (risk === "low") {
    return { decision: "allow", reason: "low risk on_request", signature, risk };
  }
  return { decision: "ask", reason: "operator request required", signature, risk };
}

export function signatureMatchesPrefix(signature: string, prefix: string): boolean {
  const sig = signature.trim();
  const pre = prefix.trim();
  if (!pre) return false;
  return sig === pre || sig.startsWith(`${pre}:`) || sig.startsWith(pre);
}

export function approvalModeFromEnv(env: NodeJS.ProcessEnv = process.env): ApprovalMode {
  const raw = String(env.BARNEY_APPROVAL_MODE ?? "unless_trusted").trim().toLowerCase();
  if (raw === "on_request" || raw === "on_failure" || raw === "never" || raw === "unless_trusted") {
    return raw;
  }
  return "unless_trusted";
}
