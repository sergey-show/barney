import { expect, test } from "bun:test";
import { familyKey } from "./controlLoop.ts";
import { applyToolObserve, classifyToolResult, toolSignature } from "./observeTool.ts";

test("classifies TLS and blocks the exact same call", () => {
  const call = { name: "browser_open", arguments: { url: "https://10.0.0.120/ui/" } };
  expect(toolSignature(call)).toContain("10.0.0.120");
  expect(classifyToolResult("Error: UNABLE_TO_VERIFY_LEAF_SIGNATURE").observe).toMatch(/same URL|shell/i);
  const failed = new Set<string>();
  const first = applyToolObserve(call, "Error: UNABLE_TO_VERIFY_LEAF_SIGNATURE", failed);
  expect(first.skip).toBe(false);
  expect(first.out).toContain("Observe:");
  const second = applyToolObserve(call, "anything", failed);
  expect(second.skip).toBe(true);
  expect(second.out).toContain("BLOCKED");
});

test("saturates a tool family after two wants without liking", () => {
  const familyFails = new Map<string, number>([["browser", 2]]);
  const blocked = applyToolObserve(
    { name: "browser_click", arguments: { text: "Login" } },
    "ok",
    new Set(),
    familyFails,
  );
  expect(blocked.skip).toBe(true);
  expect(blocked.out).toContain("wanting without liking");
});

test("fs stays open when leftover files are still unwritten", () => {
  const familyFails = new Map<string, number>([["fs", 2]]);
  const write = applyToolObserve(
    { name: "fs_write", arguments: { path: "/app/check_cert.py", content: "print(1)" } },
    "wrote",
    new Set(),
    familyFails,
    { leftoverUnwritten: ["/app/check_cert.py"] },
  );
  expect(write.skip).toBe(false);
});

test("does not treat a docs page about timeout as a connection error", () => {
  const page = "opened https://bun.com/docs/runtime/networking/fetch\ntitle: Fetch\nuse AbortSignal.timeout for a fetch timeout";
  expect(classifyToolResult(page).error).toBe(false);
  expect(classifyToolResult("web_search bun fetch timeout\n(no hits) Try a different query").error).toBe(false);
});

test("does not treat a successful cert CLI as a network TLS failure", () => {
  expect(classifyToolResult("mkdir /work/certs").error).toBe(false);
  expect(classifyToolResult("wrote /work/certs/server.crt (1220 chars)").error).toBe(false);
  const certCli = [
    "exit 0",
    "subject=O = Example Org, CN = example.local",
    "notBefore=Aug 18 20:09:50 2026 GMT",
    "sha256 Fingerprint=C2:30:58:4C:FC:DB:2B:5F:DD:42:FA:C9:D9:A1:9D:D7:66:EB:44:DB:93:83:CE:71:23:36:E2:BB:88:DB:EE:88",
  ].join("\n");
  expect(classifyToolResult(certCli).error).toBe(false);
  const failed = new Set<string>();
  const familyFails = new Map<string, number>();
  const seen = applyToolObserve(
    { name: "shell", arguments: { command: "openssl req -x509 -out /work/certs/server.crt" } },
    certCli,
    failed,
    familyFails,
  );
  expect(seen.skip).toBe(false);
  expect(seen.out).not.toContain("Observe:");
  expect(familyFails.get("shell") ?? 0).toBe(0);
});

test("classifies TLS from error codes, not certificate prose", () => {
  expect(classifyToolResult("error: UNABLE_TO_VERIFY_LEAF_SIGNATURE").observe).toMatch(/same URL|shell/i);
  expect(classifyToolResult("exit 35\ncurl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL").error).toBe(true);
  expect(classifyToolResult("error: net::ERR_CERT_AUTHORITY_INVALID").error).toBe(true);
  expect(classifyToolResult("exit 1\nreq: Use -help for summary.").error).toBe(true);
  expect(classifyToolResult("exit 1\nreq: Use -help for summary.").observe).toMatch(/change tool/i);
});

test("still allows browser_open of a new URL after the family is saturated", () => {
  const familyFails = new Map<string, number>([["browser", 2]]);
  const opened = applyToolObserve(
    { name: "browser_open", arguments: { url: "https://bun.sh/docs/runtime/networking/fetch" } },
    "opened https://bun.sh/docs/runtime/networking/fetch\ntitle: Fetch",
    new Set(),
    familyFails,
  );
  expect(opened.skip).toBe(false);
});

test("shell stays usable after two different failures; exact same command still blocks", () => {
  const familyFails = new Map<string, number>([["shell", 2]]);
  const next = applyToolObserve(
    { name: "shell", arguments: { command: "python3 /work/check.py" } },
    "exit 0\n(no output)",
    new Set(),
    familyFails,
  );
  expect(next.skip).toBe(false);
  const failed = new Set<string>();
  const call = { name: "shell", arguments: { command: "python3 / work/check.py" } };
  applyToolObserve(call, "exit 1\npython3: can't open file", failed, new Map());
  const repeat = applyToolObserve(call, "exit 1\npython3: can't open file", failed, new Map());
  expect(repeat.skip).toBe(true);
  expect(repeat.out).toContain("exact same");
});

test("saturates a shell verb after two fails, not the whole shell family", () => {
  const familyFails = new Map<string, number>();
  const failed = new Set<string>();
  const err = "exit 1\nreq: Use -help for summary.";
  applyToolObserve(
    { name: "shell", arguments: { command: "openssl req -x509 -out /work/a.crt" } },
    err,
    failed,
    familyFails,
  );
  applyToolObserve(
    { name: "shell", arguments: { command: "openssl genrsa -out /work/key.pem 2048" } },
    "exit 1\ngenrsa: Use -help for summary.",
    failed,
    familyFails,
  );
  const third = applyToolObserve(
    { name: "shell", arguments: { command: "openssl x509 -in /work/a.crt -noout" } },
    "exit 0",
    new Set(),
    familyFails,
  );
  expect(third.skip).toBe(true);
  expect(third.out).toMatch(/wanting without liking|shell:openssl/i);
  const other = applyToolObserve(
    { name: "shell", arguments: { command: "python3 /work/check.py" } },
    "exit 0\nok",
    new Set(),
    familyFails,
  );
  expect(other.skip).toBe(false);
});

test("cd is a prefix, not a shell family", () => {
  const familyFails = new Map<string, number>([["shell:cd", 2]]);
  const run = applyToolObserve(
    { name: "shell", arguments: { command: "cd /app && python3 /app/filter.py test.html" } },
    "exit 0\nok",
    new Set(),
    familyFails,
  );
  expect(familyKey({ name: "shell", arguments: { command: "cd /app && python3 /app/filter.py test.html" } })).toBe("shell:python3");
  expect(run.skip).toBe(false);
});

test("path outside the worktree tells the model to use shell and does not saturate fs", () => {
  const call = { name: "fs_write", arguments: { path: "/etc/nginx/nginx.conf" } };
  const out = "error: path escapes worktree";
  expect(classifyToolResult(out).observe).toMatch(/shell/i);
  const familyFails = new Map<string, number>();
  const first = applyToolObserve(call, out, new Set(), familyFails);
  expect(first.skip).toBe(false);
  expect(first.out).toMatch(/cat >|tee|sed/i);
  expect(familyFails.get("fs") ?? 0).toBe(0);
  const other = applyToolObserve(
    { name: "fs_write", arguments: { path: "/etc/nginx/conf.d/benchmark-site.conf" } },
    out,
    new Set(),
    familyFails,
  );
  expect(other.skip).toBe(false);
  expect(familyFails.get("fs") ?? 0).toBe(0);
  const failed = new Set<string>();
  applyToolObserve(call, out, failed, familyFails);
  const repeat = applyToolObserve(call, out, failed, familyFails);
  expect(repeat.skip).toBe(true);
  expect(repeat.out).toContain("exact same");
});

test("fs_read of a Python file is not a network error and does not saturate fs", () => {
  const py = [
    "#!/usr/bin/env python3",
    "import ssl",
    "from datetime import datetime, timezone",
    "try:",
    "    ctx = ssl.create_default_context()",
    "except TimeoutError:",
    "    raise Exception('timeout')",
  ].join("\n");
  expect(classifyToolResult(py, "fs_read").error).toBe(false);
  const familyFails = new Map<string, number>();
  const failed = new Set<string>();
  const first = applyToolObserve(
    { name: "fs_read", arguments: { path: "work/check.py" } },
    py,
    failed,
    familyFails,
  );
  expect(first.skip).toBe(false);
  expect(first.out).not.toContain("Observe:");
  expect(familyFails.get("fs") ?? 0).toBe(0);
  applyToolObserve(
    { name: "fs_read", arguments: { path: "work/notes.txt" } },
    "TimeoutError in a comment\n",
    failed,
    familyFails,
  );
  const listed = applyToolObserve(
    { name: "fs_list", arguments: { path: "." } },
    "dir work\nfile check.py",
    failed,
    familyFails,
  );
  expect(listed.skip).toBe(false);
  expect(familyFails.get("fs") ?? 0).toBe(0);
});

test("grep for the mask letters tells the model to use the full token", () => {
  const seen = applyToolObserve(
    { name: "shell", arguments: { command: "grep -rn DETECTED_SECRET --include='*.py' ." } },
    "exit 1\n(no output)",
    new Set(),
  );
  expect(seen.out).toMatch(/full DETECTED_SECRET_|fs_edit|sed/i);
  const token = applyToolObserve(
    {
      name: "shell",
      arguments: { command: "sed -i 's/DETECTED_SECRET_CREDENTIAL_12D84780/<your-aws-access-key-id>/' f.py" },
    },
    "exit 0\n(no output)",
    new Set(),
  );
  expect(token.out).not.toContain("Observe:");
});

test("shell redirect that fails after > tells the model to ls, not retry", () => {
  const seen = applyToolObserve(
    {
      name: "shell",
      arguments: { command: "cat /work/a.bin /work/b.bin > /work/out.bin && chmod 600 /work/out.bi" },
    },
    "exit 1\nchmod: cannot access '/work/out.bi': No such file or directory",
    new Set(),
  );
  expect(seen.skip).toBe(false);
  expect(seen.out).toMatch(/redirect|ls the target/i);
});

test("shell command with leaked commentary is not executed", () => {
  const failed = new Set<string>();
  const familyFails = new Map<string, number>();
  const leaked = applyToolObserve(
    {
      name: "shell",
      arguments: { command: "mkdir -p /work && python3 /work/check.py... wait, the user wants me to break into small tool steps" },
    },
    "would not run",
    failed,
    familyFails,
  );
  expect(leaked.skip).toBe(true);
  expect(leaked.out).toMatch(/commentary|clean one-liner/i);
  expect(familyFails.get("shell") ?? 0).toBe(0);
  const clean = applyToolObserve(
    { name: "shell", arguments: { command: "python3 /work/check.py" } },
    "exit 0\n(no output)",
    new Set(),
  );
  expect(clean.skip).toBe(false);
});
