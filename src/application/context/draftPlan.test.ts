import { expect, test } from "bun:test";
import { draftPlan, formatPlan } from "./draftPlan.ts";

test("pins the session URL as the first step", () => {
  const steps = draftPlan({
    goal: "открой https://10.0.0.120/ui/ и выведи список",
    latest: "выведи список",
    anchors: ["https://10.0.0.120/ui/"],
  });
  expect(steps[0]).toContain("https://10.0.0.120/ui/");
  expect(steps.join("\n")).not.toMatch(/jira|esxi|virtual machine/i);
  expect(formatPlan(steps)).toMatch(/^1\. /);
});

test("past fail markers shift the plan before a new guess", () => {
  const steps = draftPlan({
    goal: "открой https://10.0.0.120/ui/",
    latest: "список",
    anchors: ["https://10.0.0.120/ui/"],
    markers: ["On TLS error retry the same URL with shell"],
  });
  expect(steps.join("\n")).toMatch(/same URL|shell/i);
  expect(steps.join("\n")).toContain("Marker from past fail");
});
