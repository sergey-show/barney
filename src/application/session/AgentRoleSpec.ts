/**
 * Agent role specs — file/memory-shaped contracts for spawn/delegate specialists.
 */

export type AgentRoleName = "explorer" | "implementer" | "reviewer" | "general";

export type AgentRoleSpec = {
  name: AgentRoleName | string;
  title: string;
  /** Tools allowed beyond the child baseline; empty = baseline only. */
  allowTools: string[];
  /** Tools denied even if otherwise available. */
  denyTools: string[];
  /** Preferred solve path hints. */
  bias: "explore" | "act" | "review";
  systemAddon: string;
};

export const DEFAULT_ROLE_SPECS: Record<string, AgentRoleSpec> = {
  explorer: {
    name: "explorer",
    title: "Explorer",
    allowTools: ["fs_read", "grep", "glob", "ls", "memory_search", "memory_read"],
    denyTools: ["fs_write", "fs_edit", "fs_append", "patch", "shell", "process_spawn"],
    bias: "explore",
    systemAddon: "Explore and report. Do not mutate the worktree.",
  },
  implementer: {
    name: "implementer",
    title: "Implementer",
    allowTools: [],
    denyTools: ["agent_spawn", "agent_delegate"],
    bias: "act",
    systemAddon: "Implement the assigned slice. Keep changes minimal and verified.",
  },
  reviewer: {
    name: "reviewer",
    title: "Reviewer",
    allowTools: ["fs_read", "grep", "glob", "ls", "shell", "memory_read"],
    denyTools: ["fs_write", "fs_edit", "fs_append", "patch", "agent_spawn", "agent_delegate"],
    bias: "review",
    systemAddon: "Review evidence and risks. Prefer fail with concrete blockers over vague pass.",
  },
  general: {
    name: "general",
    title: "General",
    allowTools: [],
    denyTools: [],
    bias: "act",
    systemAddon: "",
  },
};

export function resolveAgentRole(name: string, overrides?: Partial<AgentRoleSpec>): AgentRoleSpec {
  const key = name.trim().toLowerCase() || "general";
  const base = DEFAULT_ROLE_SPECS[key] ?? {
    ...DEFAULT_ROLE_SPECS.general!,
    name: key,
    title: key,
  };
  return {
    ...base,
    ...overrides,
    name: overrides?.name ?? base.name,
    allowTools: overrides?.allowTools ?? [...base.allowTools],
    denyTools: overrides?.denyTools ?? [...base.denyTools],
    systemAddon: overrides?.systemAddon ?? base.systemAddon,
  };
}

export function parseAgentRoleFile(contents: string): AgentRoleSpec | null {
  try {
    const parsed = JSON.parse(contents) as Partial<AgentRoleSpec> & { name?: string };
    if (!parsed?.name) return null;
    const overrides: Partial<AgentRoleSpec> = {};
    if (parsed.title) overrides.title = String(parsed.title);
    if (Array.isArray(parsed.allowTools)) overrides.allowTools = parsed.allowTools.map(String);
    if (Array.isArray(parsed.denyTools)) overrides.denyTools = parsed.denyTools.map(String);
    if (parsed.bias === "explore" || parsed.bias === "review" || parsed.bias === "act") {
      overrides.bias = parsed.bias;
    }
    if (parsed.systemAddon != null) overrides.systemAddon = String(parsed.systemAddon);
    return resolveAgentRole(String(parsed.name), overrides);
  } catch {
    return null;
  }
}

export function roleAllowsTool(role: AgentRoleSpec, toolName: string): boolean {
  if (role.denyTools.includes(toolName)) return false;
  if (!role.allowTools.length) return true;
  return role.allowTools.includes(toolName);
}
