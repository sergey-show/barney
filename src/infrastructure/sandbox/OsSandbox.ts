import { realpathSync } from "node:fs";
import { platform } from "node:os";

export type SandboxProfile = "workspace_write" | "read_only" | "full";

export type SandboxSpec = {
  cwd: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  /** Default workspace_write. full = passthrough (no OS wrapper). */
  profile?: SandboxProfile;
};

/**
 * Paths that must be writable inside the macOS seatbelt profile.
 *
 * On Darwin, `/var` is a symlink to `/private/var`. `sandbox-exec` matches
 * `subpath` literally — allowing only `/var/folders/...` denies writes that
 * resolve through `/private/var/folders/...` (EPERM on `node` / `rm`).
 * Always include both the given cwd and its realpath (+ /var ↔ /private/var).
 */
export function darwinWriteSubpaths(cwd: string): string[] {
  const paths = new Set<string>();
  const add = (raw: string) => {
    const p = raw.replace(/\/+$/, "") || "/";
    if (p) paths.add(p);
  };
  add(cwd);
  try {
    add(realpathSync(cwd));
  } catch {
    /* cwd may not exist yet at wrap time */
  }
  if (cwd.startsWith("/var/")) add(`/private${cwd}`);
  if (cwd.startsWith("/private/var/")) add(cwd.slice("/private".length));
  // Also alias any realpath variants already collected.
  for (const p of [...paths]) {
    if (p.startsWith("/var/")) paths.add(`/private${p}`);
    if (p.startsWith("/private/var/")) paths.add(p.slice("/private".length));
  }
  return [...paths];
}

function escapeSeatbeltPath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function wrapSandboxed(spec: SandboxSpec): { command: string; args: string[]; profile: SandboxProfile } {
  const profile = spec.profile ?? "workspace_write";
  if (profile === "full") {
    return { command: spec.command, args: spec.args, profile };
  }
  if (platform() === "darwin") {
    const writeRule = profile === "read_only"
      ? `(deny file-write*)`
      : darwinWriteSubpaths(spec.cwd)
        .map((p) => `(allow file-write* (subpath "${escapeSeatbeltPath(p)}"))`)
        .join("\n");
    const sandboxProfile = `(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow file-read*)
${writeRule}
(allow network-outbound (remote ip) (remote unix-socket))
(allow sysctl-read)
`;
    return {
      command: "sandbox-exec",
      args: ["-p", sandboxProfile, spec.command, ...spec.args],
      profile,
    };
  }
  if (platform() === "linux") {
    const bwrap = Bun.which("bwrap");
    if (bwrap) {
      return { command: bwrap, args: linuxSandboxArgs(spec, profile), profile };
    }
  }
  return { command: spec.command, args: spec.args, profile };
}

/**
 * Tighter default bubblewrap profile:
 * - read-only root; worktree writable unless read_only
 * - fresh /tmp; isolated pid/ipc/uts namespaces
 * - no new privileges
 */
export function linuxSandboxArgs(spec: SandboxSpec, profile: SandboxProfile = "workspace_write"): string[] {
  const bindWorktree = profile === "read_only"
    ? ["--ro-bind", spec.cwd, spec.cwd]
    : ["--bind", spec.cwd, spec.cwd];
  return [
    "--die-with-parent",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--hostname", "barney-sandbox",
    "--new-session",
    "--cap-drop", "ALL",
    "--ro-bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    "--tmpfs", "/tmp",
    ...bindWorktree,
    "--chdir", spec.cwd,
    spec.command,
    ...spec.args,
  ];
}

export function sandboxProfileFromEnv(env: NodeJS.ProcessEnv = process.env): SandboxProfile {
  const raw = String(env.BARNEY_SANDBOX_PROFILE ?? "workspace_write").trim().toLowerCase();
  if (raw === "read_only" || raw === "full" || raw === "workspace_write") return raw;
  return "workspace_write";
}
