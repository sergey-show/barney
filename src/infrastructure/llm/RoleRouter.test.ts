import { expect, test } from "bun:test";
import { collapseSystemMessages, ensureUserQuery } from "./RoleRouter.ts";

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

test("ensureUserQuery pins a trailing user after tool results", () => {
  const injected = ensureUserQuery([
    { role: "system", content: "sys" },
    { role: "user", content: "do the task" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "shell", arguments: {} }] },
    { role: "tool", toolCallId: "c1", name: "shell", content: "ok" },
  ]);
  expect(injected.at(-1)?.role).toBe("user");
  expect(String(injected.at(-1)?.content)).toMatch(/Continue/);
  expect(injected.filter((m) => m.role === "user")).toHaveLength(2);

  const kept = ensureUserQuery([
    { role: "system", content: "sys" },
    { role: "user", content: "do it" },
  ]);
  expect(kept).toHaveLength(2);
  expect(kept[1]?.content).toBe("do it");

  const emptyUser = ensureUserQuery([
    { role: "user", content: "   " },
    { role: "assistant", content: "x" },
  ]);
  expect(emptyUser.at(-1)?.role).toBe("user");
  expect(String(emptyUser.at(-1)?.content).trim().length).toBeGreaterThan(0);
});
