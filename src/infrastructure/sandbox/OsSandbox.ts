import { platform } from "node:os";

export type SandboxSpec = {
  cwd: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export function wrapSandboxed(spec: SandboxSpec): { command: string; args: string[] } {
  if (platform() === "darwin") {
    const cwd = spec.cwd.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const profile = `(version 1)
(deny default)
(allow process-exec)
(allow process-fork)
(allow file-read*)
(allow file-write* (subpath "${cwd}"))
(allow network-outbound (remote ip) (remote unix-socket))
(allow sysctl-read)
`;
    return { command: "sandbox-exec", args: ["-p", profile, spec.command, ...spec.args] };
  }
  if (platform() === "linux") {
    const bwrap = Bun.which("bwrap");
    if (bwrap) return { command: bwrap, args: linuxSandboxArgs(spec) };
  }
  return { command: spec.command, args: spec.args };
}

export function linuxSandboxArgs(spec: SandboxSpec): string[] {
  return [
    "--die-with-parent",
    "--ro-bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    "--tmpfs", "/tmp",
    "--bind", spec.cwd, spec.cwd,
    spec.command,
    ...spec.args,
  ];
}
