import { expect, test } from "bun:test";
import {
  applyDreamHeuristics,
  compressShadowLocally,
  needsDream,
  parseDreamHeuristics,
} from "./dream.ts";
import { nextIdleWork } from "./idleTick.ts";
import { seedSamost } from "./samost.ts";

test("needsDream when shadow is bloated with real lines", () => {
  const short = seedSamost();
  expect(needsDream(short.shadow)).toBe(false);
  const bloated = Array.from({ length: 8 }, (_, i) => `Repeated shell:openssl fail on cert attempt ${i} — change tool.`);
  expect(needsDream(bloated)).toBe(true);
});

test("parseDreamHeuristics reads JSON or bullets", () => {
  expect(parseDreamHeuristics('["After openssl timeout, use python cryptography", "Do not invent API hosts"]')).toEqual([
    "After openssl timeout, use python cryptography",
    "Do not invent API hosts",
  ]);
  expect(parseDreamHeuristics("- Prefer fs_write over shell redirects for small files\n- Change browser host after TLS fail")).toHaveLength(2);
});

test("local compress keeps distinctive heuristics under the cap", () => {
  const lines = [
    "shell:openssl timed out on genrsa again",
    "shell:openssl timed out on genrsa again with same flags",
    "browser_open to wrong host after TLS miss",
    "Invented API path without docs evidence",
    "fs_write wrote DETECTED_SECRET mask into deliverable",
    "Repeated curl to dead localhost MCP",
    "Same sed edit failed twice without restore",
    "Unrun program after write — no python3 check",
  ];
  const out = compressShadowLocally(lines, 5);
  expect(out.length).toBeGreaterThan(0);
  expect(out.length).toBeLessThanOrEqual(5);
});

test("applyDreamHeuristics replaces bloated shadow with heuristics", () => {
  const base = seedSamost();
  base.shadow = Array.from({ length: 10 }, (_, i) => `Raw fail log number ${i} with openssl timeout detail`);
  const next = applyDreamHeuristics(base, [
    "After openssl timeout, switch to python cryptography",
    "Do not invent API hosts without evidence",
  ]);
  expect(next.shadow.some((line) => /openssl timeout/i.test(line))).toBe(true);
  expect(next.shadow.length).toBeLessThanOrEqual(12);
});

test("idle prefers dream over absorb when shadow is bloated", () => {
  const samost = seedSamost();
  samost.shadow = Array.from({ length: 8 }, (_, i) => `Fail pattern ${i}: shell family saturated on certs`);
  expect(nextIdleWork({
    samostPresent: true,
    samost,
    existence: [],
    board: [],
    rules: ["[unrun-program] if shell:openssl fails, do not repeat shell:openssl."],
    idleMs: 1_000,
  }).item).toBe("dream");
});
