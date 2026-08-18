import { expect, test } from "bun:test";
import { linuxSandboxArgs } from "./OsSandbox.ts";

test("linux bubblewrap binds the worktree writable over a read-only root", () => {
  const args = linuxSandboxArgs({ cwd: "/tmp/work", command: "/bin/sh", args: ["-c", "echo hi"] });
  expect(args.slice(0, 8)).toEqual(["--die-with-parent", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc"]);
  expect(args).toContain("--bind");
  expect(args).toContain("/tmp/work");
  expect(args.at(-3)).toBe("/bin/sh");
  expect(args.at(-1)).toBe("echo hi");
});
