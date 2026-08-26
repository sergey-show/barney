import { expect, test } from "bun:test";
import { ensureToolEvidence, extractToolEvidence } from "./toolEvidence.ts";

const PWD = "/dir/AI/barney_bot";
const MODEL = "MacBookPro10,2";

test("extractToolEvidence keeps stdout lines, not the tool head or exit code", () => {
  expect(extractToolEvidence(`shell ${JSON.stringify({ command: "pwd" })}\nexit 0\n${PWD}\n`)).toEqual([PWD]);
});

test("ensureToolEvidence appends the exact tool line when the model rewrote it", () => {
  const raw = "Мы в /dir/АИ/barney_bot";
  const out = ensureToolEvidence(raw, [PWD]);
  expect(out).toContain(raw);
  expect(out).toContain(PWD);
});

test("ensureToolEvidence works for any tool atom, not only paths", () => {
  expect(ensureToolEvidence("модель примерно MacBookPro1O,2", [MODEL])).toContain(MODEL);
});

test("ensureToolEvidence does not duplicate an already exact copy", () => {
  expect(ensureToolEvidence(`cwd ${PWD}`, [PWD])).toBe(`cwd ${PWD}`);
});
