import { expect, test } from "bun:test";
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

test("does not treat a docs page about timeout as a connection error", () => {
  const page = "opened https://bun.com/docs/runtime/networking/fetch\ntitle: Fetch\nuse AbortSignal.timeout for a fetch timeout";
  expect(classifyToolResult(page).error).toBe(false);
  expect(classifyToolResult("web_search bun fetch timeout\n(no hits) Try a different query").error).toBe(false);
});

test("does not treat openssl and ssl paths as a network TLS failure", () => {
  expect(classifyToolResult("mkdir /app/ssl").error).toBe(false);
  expect(classifyToolResult("wrote /app/ssl/server.crt (1220 chars)").error).toBe(false);
  const openssl = [
    "exit 0",
    "subject=O = DevOps Team, CN = dev-internal.company.local",
    "notBefore=Aug 18 20:09:50 2026 GMT",
    "sha256 Fingerprint=C2:30:58:4C:FC:DB:2B:5F:DD:42:FA:C9:D9:A1:9D:D7:66:EB:44:DB:93:83:CE:71:23:36:E2:BB:88:DB:EE:88",
  ].join("\n");
  expect(classifyToolResult(openssl).error).toBe(false);
  const failed = new Set<string>();
  const familyFails = new Map<string, number>();
  const seen = applyToolObserve(
    { name: "shell", arguments: { command: "openssl req -x509 -out /app/ssl/server.crt" } },
    openssl,
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
    { name: "shell", arguments: { command: "openssl genrsa -out /app/ssl/server.key 2048" } },
    "exit 0\n(no output)",
    new Set(),
    familyFails,
  );
  expect(next.skip).toBe(false);
  const failed = new Set<string>();
  const call = { name: "shell", arguments: { command: "openssl x509 -in / app/ssl/server.crt" } };
  applyToolObserve(call, "exit 1\nx509: Use -help for summary.", failed, new Map());
  const repeat = applyToolObserve(call, "exit 1\nx509: Use -help for summary.", failed, new Map());
  expect(repeat.skip).toBe(true);
  expect(repeat.out).toContain("exact same");
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
