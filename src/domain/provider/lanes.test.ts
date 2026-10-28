import { expect, test } from "bun:test";
import { lanesFromBindings, rolesForLane } from "./lanes.ts";
import { FAST_ROLES, SLOW_ROLES } from "./Role.ts";

test("lanes split fast vs slow roles", () => {
  expect(rolesForLane("large")).toEqual(SLOW_ROLES);
  expect(rolesForLane("small")).toEqual(FAST_ROLES);
});

test("unified bindings keep small lane null", () => {
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

test("divergent planner model fills small lane", () => {
  const lanes = lanesFromBindings([
    { role: "coder", providerId: "p-big", model: "qwen-35b" },
    { role: "planner", providerId: "p-big", model: "qwen-7b" },
    { role: "reviewer", providerId: "p-big", model: "qwen-7b" },
  ]);
  expect(lanes.large).toEqual({ providerId: "p-big", model: "qwen-35b" });
  expect(lanes.small).toEqual({ providerId: "p-big", model: "qwen-7b" });
});
