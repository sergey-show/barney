import { expect, test } from "bun:test";
import { parseAgentRoleFile, resolveAgentRole, roleAllowsTool } from "./AgentRoleSpec.ts";

test("explorer cannot mutate", () => {
  const role = resolveAgentRole("explorer");
  expect(roleAllowsTool(role, "fs_read")).toBe(true);
  expect(roleAllowsTool(role, "fs_write")).toBe(false);
});

test("parses role json", () => {
  const role = parseAgentRoleFile(JSON.stringify({
    name: "reviewer",
    systemAddon: "Be strict",
  }));
  expect(role?.bias).toBe("review");
  expect(role?.systemAddon).toContain("strict");
});
