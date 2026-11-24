import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { darwinWriteSubpaths, linuxSandboxArgs, wrapSandboxed } from "./OsSandbox.ts";

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

test("read_only profile mounts the worktree read-only", () => {
  const args = linuxSandboxArgs(
    { cwd: "/tmp/work", command: "/bin/sh", args: ["-c", "echo hi"] },
    "read_only",
  );
  const bindIdx = args.findIndex((a, i) => a === "--ro-bind" && args[i + 1] === "/tmp/work");
  expect(bindIdx).toBeGreaterThanOrEqual(0);
  expect(args).not.toContain("--bind");
});

test("darwinWriteSubpaths includes /var and /private/var aliases", () => {
  const paths = darwinWriteSubpaths("/var/folders/xx/example");
  expect(paths).toContain("/var/folders/xx/example");
  expect(paths).toContain("/private/var/folders/xx/example");
});

test("darwinWriteSubpaths includes realpath when cwd exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "barney-sandbox-"));
  try {
    const paths = darwinWriteSubpaths(dir);
    expect(paths).toContain(dir.replace(/\/+$/, ""));
    expect(paths).toContain(realpathSync(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("darwin sandbox-exec allows write+rm via /var cwd when realpath is /private/var", async () => {
  if (process.platform !== "darwin") return;
  const base = mkdtempSync(join(tmpdir(), "barney-sandbox-live-"));
  // Prefer /var form when tmpdir resolves under /private/var (common on macOS).
  const cwd = base.startsWith("/private/var/") ? `/var${base.slice("/private".length)}` : base;
  mkdirSync(join(cwd, "junk", "build"), { recursive: true });
  writeFileSync(join(cwd, "junk", "build", "decoy.txt"), "x");
  try {
    const launched = wrapSandboxed({
      cwd,
      command: "/bin/sh",
      args: ["-c", "node -e \"require('fs').writeFileSync('ok.txt','1')\" && rm -rf junk/build && test ! -e junk/build && test -f ok.txt"],
      profile: "workspace_write",
    });
    expect(launched.command).toBe("sandbox-exec");
    const profile = launched.args[1] ?? "";
    expect(profile).toContain('subpath "/var/');
    expect(profile).toContain('subpath "/private/var/');
    const proc = Bun.spawn([launched.command, ...launched.args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("EPERM");
    expect(stdout).toBe("");
  } finally {
    rmSync(realpathSync(cwd), { recursive: true, force: true });
  }
});
