import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "./Kernel.ts";

test("operator can list, write, and protect samost memory", async () => {
  const kernel = new Kernel(mkdtempSync(join(tmpdir(), "barney-mem-")));
  const agent = await kernel.boot();
  const written = await kernel.writeMemory({
    title: "Lesson from 3090",
    body: "Copy the host URL in full.",
    tags: ["rule", "operator"],
  });
  expect(written.title).toBe("Lesson from 3090");
  const listed = await kernel.listMemory("3090");
  expect(listed.some((note) => note.id === written.id)).toBe(true);
  await expect(kernel.removeMemory(`samost/${agent.id.value}`)).rejects.toThrow(/Psyche/);
  expect(await kernel.removeMemory(written.key)).toBe(true);
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
