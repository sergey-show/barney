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

export function wrapSandboxed(spec: SandboxSpec): { command: string; args: string[]; profile: SandboxProfile } {
  const profile = spec.profile ?? "workspace_write";
  if (profile === "full") {
    return { command: spec.command, args: spec.args, profile };
  }
  if (platform() === "darwin") {
    const cwd = spec.cwd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const writeRule = profile === "read_only"
      ? `(deny file-write*)`
      : `(allow file-write* (subpath "${cwd}"))`;
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
