import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HomeRepo } from "./HomeRepo.ts";

test("home becomes a local git body that can commit and roll back", async () => {
  const home = mkdtempSync(join(tmpdir(), "barney-home-"));
  const repo = new HomeRepo(home);
  await repo.ensure();
  await repo.exportSamost("# Self\n## Compass\nfirst\n");
  const first = await repo.commit("become: samost");
  expect(first).not.toBe("clean");

  mkdirSync(join(home, "plugins", "demo"), { recursive: true });
  writeFileSync(join(home, "plugins", "demo", "plugin.json"), '{"name":"demo"}');
  const plugin = await repo.commit("become: plugin demo");
  expect(plugin).not.toBe("clean");
  expect(await repo.log(5)).toContain("plugin demo");

  await repo.exportSamost("# Self\n## Compass\nsecond\n");
  await repo.commit("become: samost again");
  const back = await repo.rollback("HEAD~1");
  expect(back).toContain("rolled back");
  expect(readFileSync(join(home, "self", "samost.md"), "utf8")).toContain("first");

  writeFileSync(join(home, "barney.sqlite"), "secret-db");
  const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: home, stdout: "pipe" });
  expect(Buffer.from(tracked.stdout).toString()).not.toContain("barney.sqlite");
  expect(await repo.rollback("../foo")).toContain("refuse");
});
