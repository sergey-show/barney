import { expect, test } from "bun:test";
import {
  consolidateLearnedBlocks,
  consolidateRuleLines,
  needsLearnedConsolidation,
  splitLearnedBlocks,
} from "./consolidateLearned.ts";

const BASE = `## Immune
Never rewrite the kernel.
Motive is locked.`;

test("splitLearnedBlocks keeps immune base intact", () => {
  const text = `${BASE}

# Learned
If shell:grep fails twice, switch family.

# Learned
After openssl fails, prefer python3.

# Learned
If shell:grep fails twice, change tool family.`;
  const { base, blocks } = splitLearnedBlocks(text);
  expect(base).toContain("Never rewrite the kernel");
  expect(blocks).toHaveLength(3);
  expect(needsLearnedConsolidation(text, 3)).toBe(true);
  expect(needsLearnedConsolidation(text, 6)).toBe(false);
});

test("consolidateLearnedBlocks dedupes and does not touch base", () => {
  const text = `${BASE}

# Learned
If shell:grep fails twice, switch family.

# Learned
If shell:grep fails twice, change tool family.

# Learned
Prefer python3 after openssl fail.

# Learned
Prefer python3 after openssl fails on mac.

# Learned
Do not invent MCP.

# Learned
Do not invent MCP tools without list.`;
  const result = consolidateLearnedBlocks(text, 8);
  expect(result.changed).toBe(true);
  expect(result.after).toBeLessThan(result.before);
  expect(result.constitution.startsWith("## Immune")).toBe(true);
  expect(result.constitution).toContain("# Learned");
  expect(result.constitution).not.toMatch(/You are/i);
  // Immune lines untouched
  expect(result.constitution).toContain("Never rewrite the kernel");
  expect(result.constitution).toContain("Motive is locked");
});

test("consolidateRuleLines merges near-duplicates", () => {
  const result = consolidateRuleLines([
    "If shell:grep fails, do not repeat shell:grep.",
    "If shell:grep fails, do not repeat grep; switch family.",
    "Prefer browser_show for portal preview.",
  ], 6);
  expect(result.after).toBeLessThan(result.before);
  expect(result.changed).toBe(true);
  expect(result.lines.some((line) => /browser_show/i.test(line))).toBe(true);
});
