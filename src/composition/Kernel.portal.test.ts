import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryNote } from "../domain/memory/MemoryNote.ts";
import { Kernel } from "./Kernel.ts";

test("operator can list, write, and protect samost memory", async () => {
  const kernel = new Kernel(mkdtempSync(join(tmpdir(), "barney-mem-")));
  const agent = await kernel.boot();
  const written = await kernel.writeMemory({
    title: "Lesson from 3090",
    body: "Copy the host URL in full.",
    tags: ["operator"],
  });
  expect(written.title).toBe("Lesson from 3090");
  const listed = await kernel.listMemory("3090");
  expect(listed.some((note) => note.id === written.id)).toBe(true);
  await expect(kernel.removeMemory(`samost/${agent.id.value}`)).rejects.toThrow(/your notes/i);
  expect(await kernel.removeMemory(written.key)).toBe(true);
});

test("lessons cannot be edited or deleted from the notes API", async () => {
  const kernel = new Kernel(mkdtempSync(join(tmpdir(), "barney-lesson-")));
  await kernel.boot();
  await kernel.memories.save(new MemoryNote({
    key: "rule/general/host",
    title: "Run the checker",
    body: "do not repeat the failed call",
    tags: ["rule", "fail"],
  }));
  await expect(kernel.writeMemory({
    key: "rule/general/host",
    title: "hack",
    body: "edited by hand",
  })).rejects.toThrow(/Lessons/);
  await expect(kernel.removeMemory("rule/general/host")).rejects.toThrow(/your notes/i);
});

test("psyche update writes compass and rejects You are", async () => {
  const kernel = new Kernel(mkdtempSync(join(tmpdir(), "barney-psy-")));
  await kernel.boot();
  const next = await kernel.updatePsyche({
    compass: "Делать конкретный результат для Сергея.",
    character: ["Упрямый", "Честный"],
  });
  expect(next.samost.compass).toContain("Сергея");
  expect(next.samost.character).toContain("Упрямый");
  await expect(kernel.updatePsyche({ constitution: "You are Barney the helper" })).rejects.toThrow(/You are/);
});
