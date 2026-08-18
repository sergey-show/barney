import { expect, test } from "bun:test";
import { lanesFromBindings, rolesForLane } from "./lanes.ts";

test("large lane is coder and researcher", () => {
  expect(rolesForLane("large")).toEqual(["coder", "researcher"]);
  expect(rolesForLane("small")).toEqual(["planner", "reviewer", "embedder"]);
});

test("lanes read coder as large and reviewer as small", () => {
  const lanes = lanesFromBindings([
    { role: "coder", providerId: "p-big", model: "qwen-35b" },
    { role: "researcher", providerId: "p-big", model: "qwen-35b" },
    { role: "planner", providerId: "p-small", model: "qwen-8b" },
    { role: "reviewer", providerId: "p-small", model: "qwen-8b" },
    { role: "embedder", providerId: "p-small", model: "qwen-8b" },
  ]);
  expect(lanes.large).toEqual({ providerId: "p-big", model: "qwen-35b" });
  expect(lanes.small).toEqual({ providerId: "p-small", model: "qwen-8b" });
});
