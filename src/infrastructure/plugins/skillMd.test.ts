import { expect, test } from "bun:test";
import { applySkillPlaceholders, parseSkillMd, toPluginName } from "./skillMd.ts";

test("slugs plugin names to kebab-case", () => {
  expect(toPluginName("Git Release")).toBe("git-release");
  expect(toPluginName("pdf-processing")).toBe("pdf-processing");
  expect(toPluginName("---")).toBeNull();
});

test("parses AgentSkills frontmatter", () => {
  const parsed = parseSkillMd(`---
name: pdf-processing
description: Extract text from PDFs. Use when the user mentions PDFs.
metadata:
  version: "1.0"
  author: example-org
---

Run scripts/extract.py from {baseDir}.
`);
  expect(parsed.hasFrontmatter).toBe(true);
  expect(parsed.name).toBe("pdf-processing");
  expect(parsed.description).toContain("PDFs");
  expect(parsed.version).toBe("1.0");
  expect(parsed.metadata.author).toBe("example-org");
  expect(parsed.body).toContain("scripts/extract.py");
  expect(parsed.body).not.toContain("name: pdf-processing");
});

test("replaces skill placeholders", () => {
  expect(applySkillPlaceholders("see {baseDir}/x and ${CLAUDE_PLUGIN_ROOT}/y", "/tmp/plug"))
    .toBe("see /tmp/plug/x and /tmp/plug/y");
});
