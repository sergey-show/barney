import { expect, test } from "bun:test";
import { linuxSandboxArgs } from "./OsSandbox.ts";

test("linux bubblewrap binds the worktree writable over a read-only root", () => {
  const args = linuxSandboxArgs({ cwd: "/tmp/work", command: "/bin/sh", args: ["-c", "echo hi"] });
  expect(args[0]).toBe("--die-with-parent");
  expect(args).toContain("--unshare-pid");
  expect(args).toContain("--cap-drop");
  expect(args).toContain("ALL");
  expect(args).toContain("--ro-bind");
  expect(args).toContain("--bind");
  expect(args).toContain("/tmp/work");
  expect(args).toContain("--chdir");
  expect(args.at(-3)).toBe("/bin/sh");
  expect(args.at(-1)).toBe("echo hi");
});
