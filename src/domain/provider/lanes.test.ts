import { expect, test } from "bun:test";
import { lanesFromBindings, rolesForLane } from "./lanes.ts";
import { ROLES } from "./Role.ts";

test("both former lanes use the same role set", () => {
  expect(rolesForLane("large")).toEqual(ROLES);
  expect(rolesForLane("small")).toEqual(ROLES);
});

test("lanes expose one bound model; no small lane", () => {
  const lanes = lanesFromBindings([
    { role: "coder", providerId: "p-big", model: "qwen-35b" },
    { role: "researcher", providerId: "p-big", model: "qwen-35b" },
    { role: "planner", providerId: "p-big", model: "qwen-35b" },
    { role: "reviewer", providerId: "p-big", model: "qwen-35b" },
    { role: "embedder", providerId: "p-big", model: "qwen-35b" },
  ]);
  expect(lanes.large).toEqual({ providerId: "p-big", model: "qwen-35b" });
  expect(lanes.small).toBeNull();
});
