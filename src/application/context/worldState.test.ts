import { expect, test } from "bun:test";
import {
  formatWorldStateForPrompt,
  mergeFileListsIntoWorldState,
  parseWorldStateFromCompact,
} from "./worldState.ts";

test("parses markdown sections into world state", () => {
  const text = `## Goal
Ship harness
## Progress
- wired approval
## Decisions
- unless_trusted default
## Open tasks / blockers
- docs
## Risks
- elicitation hang
## Read files
- DriveSolve.ts
## Modified files
- ApprovalLadder.ts
## Next steps
- tests
`;
  const state = parseWorldStateFromCompact(text, "fallback");
  expect(state.goal).toContain("Ship");
  expect(state.progress[0]).toContain("approval");
  expect(state.readFiles).toContain("DriveSolve.ts");
  const merged = mergeFileListsIntoWorldState(state, {
    readFiles: ["extra.ts"],
    modifiedFiles: ["ApprovalLadder.ts"],
  });
  expect(merged.readFiles).toContain("extra.ts");
  expect(formatWorldStateForPrompt(merged)).toContain("<world_state>");
});

test("parses fenced world_state json", () => {
  const text = '```json\n{"goal":"g","progress":["a"],"decisions":[],"openTasks":[],"blockers":[],"risks":["r"],"readFiles":[],"modifiedFiles":[],"nextSteps":[]}\n```';
  const state = parseWorldStateFromCompact(text);
  expect(state.goal).toBe("g");
  expect(state.risks).toEqual(["r"]);
});
