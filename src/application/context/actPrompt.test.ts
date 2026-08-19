import { expect, test } from "bun:test";
import { canonDraft, constitutionFromDesign, IMMUNE_CONSTITUTION } from "../psyche/design.ts";
import { buildActSystem, turnLawFromConstitution } from "./actPrompt.ts";

test("turn law is language and Never, not the Self essay", () => {
  const law = turnLawFromConstitution(constitutionFromDesign(canonDraft()));
  expect(law).toContain("Language with the operator: ru");
  expect(law).toContain("Never:");
  expect(law).toContain("No stage, voice, or friendly biography.");
  expect(law).not.toMatch(/Compass:/);
  expect(law).not.toMatch(/Character:/);
  expect(law).not.toMatch(/^Instance /);
});

test("immune constitution has no turn-law dump", () => {
  expect(turnLawFromConstitution(IMMUNE_CONSTITUTION)).toBe("");
});

test("act system does not reread constitution or tool essays", () => {
  const system = buildActSystem({
    constitution: constitutionFromDesign(canonDraft()),
    samost: "Compass: deliver a result.",
    existence: "",
    board: "",
    goal: "https://example.com/docs",
    anchors: ["https://example.com/docs"],
    plan: "1. Open the docs",
    worktree: "/tmp/work",
    depth: 0,
    skills: "Plugins: none.",
    memory: "",
  });
  expect(system).toContain("Language with the operator: ru");
  expect(system).toContain("Session goal");
  expect(system).toContain("Tools this turn:");
  expect(system).not.toContain("Instance Barney is designed");
  expect(system).not.toContain("Work until the requested result");
  expect(system).not.toContain("Self-extension: the kernel is immutable");
  expect(system).not.toContain("Browser: you have a real headless browser");
  expect(system).not.toMatch(/^You are/m);
});
