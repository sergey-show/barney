import { expect, test } from "bun:test";
import { collapseSystemMessages } from "./RoleRouter.ts";

test("collapseSystemMessages joins system prompts", () => {
  expect(collapseSystemMessages([
    { role: "system", content: "a" },
    { role: "system", content: "b" },
    { role: "user", content: "hi" },
  ])).toEqual([
    { role: "system", content: "a\n\nb" },
    { role: "user", content: "hi" },
  ]);
});
