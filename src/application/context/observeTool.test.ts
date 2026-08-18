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
