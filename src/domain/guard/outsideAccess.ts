/**
 * Outside-worktree access: explicit grants + optional eval auto-approve.
 * Default remains deny. Auto-approve is only via BARNEY_AUTO_APPROVE_OUTSIDE.
 */

export function autoApproveOutside(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|yes)$/i.test(String(env.BARNEY_AUTO_APPROVE_OUTSIDE ?? "").trim());
}

/** Grant the parent directory of a file, or the directory itself. */
export function permissionPrefix(path: string): string {
  const raw = path.replaceAll("\\", "/").trim();
  if (!raw) return "";
  const normalized = raw.replace(/\/+$/, "") || "/";
  if (normalized === "/") return "/";
  const parts = normalized.split("/").filter(Boolean);
  // directory path (trailing slash was present, or no extension-looking last segment with dots only as version)
  if (raw.endsWith("/")) return `/${parts.join("/")}`;
  if (parts.length <= 1) return `/${parts[0] ?? ""}`;
  const last = parts.at(-1) ?? "";
  // treat as file if it has a suffix like .conf / .py / no slash end
  if (last.includes(".")) {
    return `/${parts.slice(0, -1).join("/")}`;
  }
  return `/${parts.join("/")}`;
}

export function pathAllowedByGrants(absPath: string, grants: Iterable<string>): boolean {
  const abs = absPath.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
  for (const grant of grants) {
    const prefix = grant.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
    if (prefix === "/") return true;
    if (abs === prefix || abs.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

export function escapeDeniedMessage(absPath: string): string {
  const prefix = permissionPrefix(absPath);
  return [
    `permission required: path escapes worktree (${absPath}).`,
    `Ask the operator to allow ${prefix} (CLI/portal: /allow ${prefix}).`,
    `Eval/auto: BARNEY_AUTO_APPROVE_OUTSIDE=1.`,
  ].join(" ");
}

export function permissionGrantedMessage(prefix: string, mode: "user" | "auto"): string {
  if (mode === "auto") {
    return `Outside access auto-approved for this process (BARNEY_AUTO_APPROVE_OUTSIDE): ${prefix || "(all)"}.`;
  }
  return `Outside access allowed for this session: ${prefix}. fs_* may use paths under that prefix.`;
}
