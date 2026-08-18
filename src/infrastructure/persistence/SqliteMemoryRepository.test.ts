import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryNote, slugKey } from "../../domain/memory/MemoryNote.ts";
import { openStore } from "../persistence/SqliteStore.ts";
import { SqliteMemoryRepository } from "../persistence/SqliteMemoryRepository.ts";

test("slugKey keeps stable lesson paths", () => {
  expect(slugKey("lesson/api-auth")).toBe("lesson/api-auth");
});

test("shared memory upserts by key and searches across notes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "barney-mem-"));
  const memory = new SqliteMemoryRepository(openStore(join(dir, "t.sqlite")));
  await memory.save(new MemoryNote({
    key: "lesson/auth",
    title: "Auth cookie",
    body: "Habr login needs the session cookie from browser_screenshot.",
    tags: ["lesson", "auth"],
  }));
  await memory.save(new MemoryNote({
    key: "lesson/auth",
    title: "Auth cookie",
    body: "Updated: reuse the existing cookie, do not log in again.",
    tags: ["lesson", "auth"],
  }));
  const hits = await memory.search("cookie");
  expect(hits).toHaveLength(1);
  expect(hits[0]?.body).toContain("Updated");
  expect((await memory.get("lesson/auth"))?.title).toBe("Auth cookie");
});

test("memory save keeps SQL-looking titles as data, not as commands", async () => {
  const dir = mkdtempSync(join(tmpdir(), "barney-mem-sql-"));
  const memory = new SqliteMemoryRepository(openStore(join(dir, "t.sqlite")));
  const injected = "'; DROP TABLE memories; --";
  await memory.save(new MemoryNote({
    key: "lesson/sql-title",
    title: injected,
    body: "keep the table",
    tags: ["qa"],
  }));
  await memory.save(new MemoryNote({
    key: "lesson/other",
    title: "still here",
    body: "untouched",
    tags: [],
  }));
  expect((await memory.get("lesson/sql-title"))?.title).toBe(injected);
  expect((await memory.search(injected))[0]?.key).toBe("lesson/sql-title");
  expect(await memory.get("lesson/other")).not.toBeNull();
});
