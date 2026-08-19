import { expect, test } from "bun:test";
import { addBoard, parseBoard, renderBoardPrompt } from "./board.ts";
import { appendExistence, EXISTENCE_CAP, parseExistence, renderExistencePrompt } from "./existence.ts";
import { LONG_IDLE_MS, STUDY_COOLDOWN_MS, nextIdleWork, pickStudyTopic } from "./idleTick.ts";
import { absorbIntoSamost, formatSamost, parseSamost, seedSamost } from "./samost.ts";

test("existence and board coerce non-string notes", () => {
  const blocks = appendExistence([], { kind: "review", text: { missing: ["server.pem"] } as unknown as string });
  expect(blocks).toHaveLength(1);
  expect(blocks[0]?.text).toContain("server.pem");
  const entries = addBoard([], { kind: "note", text: ["blocker", "path"] as unknown as string });
  expect(entries).toHaveLength(1);
  expect(entries[0]?.text).toContain("blocker");
});

test("existence is a FIFO draft of acts", () => {
  let blocks = parseExistence("");
  for (let i = 0; i < 12; i += 1) {
    blocks = appendExistence(blocks, { kind: "act", text: `step ${i}`, at: `t${i}` });
  }
  expect(blocks).toHaveLength(EXISTENCE_CAP);
  expect(blocks[0]?.text).toBe("step 2");
  expect(blocks.at(-1)?.text).toBe("step 11");
  expect(renderExistencePrompt(blocks)).not.toMatch(/Sartre|Camus|Jung|Leontiev/i);
});

test("samost keeps compass and absorbs shadow without wiping light", () => {
  const seeded = seedSamost();
  const next = absorbIntoSamost(seeded, "Change tool after a fail.", "shadow");
  const round = parseSamost(formatSamost(next));
  expect(round.compass).toContain("Do not change the kernel");
  expect(round.character[0]).toContain("Stubborn");
  expect(round.shadow[0]).toBe("Change tool after a fail.");
  expect(round.light.length).toBeGreaterThan(0);
});

test("parseSamost reads English headings only", () => {
  const round = parseSamost(`# Self Barney
## Compass
Keep this compass.
## Character
- A trait
## Light
- A light
## Shadow
- A shadow
`);
  expect(round.compass).toContain("Keep this compass");
  expect(round.character[0]).toContain("A trait");
  const russian = parseSamost(`# Самость Barney
## Компас
Old compass must not load.
## Характер
- Old trait
`);
  expect(russian.compass).toContain("Do not change the kernel");
  expect(russian.compass).not.toContain("Old compass");
});

test("long idle studies a failure, short idle does not wander", () => {
  const samost = seedSamost();
  expect(nextIdleWork({
    samostPresent: true,
    samost,
    existence: [],
    board: [],
    rules: [],
    idleMs: 1_000,
    failHints: ["TLS on browser login"],
  }).item).not.toBe("study");
  expect(nextIdleWork({
    samostPresent: true,
    samost,
    existence: [],
    board: [],
    rules: [],
    idleMs: LONG_IDLE_MS,
    failHints: ["TLS on browser login"],
    studied: [],
    studyCooldownMs: STUDY_COOLDOWN_MS,
  }).item).toBe("study");
  expect(pickStudyTopic({
    shadow: samost.shadow,
    failHints: ["TLS on browser login"],
    studied: ["tls on browser login"],
  })).not.toBe("TLS on browser login");
});

test("board locks motive and replaces the current operation", () => {
  const first = addBoard([], { kind: "motive", text: "https://10.0.0.120/ui/" });
  const locked = addBoard(first, { kind: "motive", text: "https://10.0.0.1/" });
  expect(locked.find((item) => item.kind === "motive")?.text).toContain("10.0.0.120");
  const moved = addBoard(addBoard(locked, { kind: "operation", text: "browser_open" }), { kind: "operation", text: "shell" });
  expect(moved.filter((item) => item.kind === "operation")).toHaveLength(1);
  expect(moved.at(-1)?.text).toBe("shell");
  const prompt = renderBoardPrompt(moved);
  expect(prompt).toContain("Motive:");
  expect(prompt).not.toMatch(/Leontiev|Jung|Sartre/i);
});

test("board dedupes facts and idle promotes an open blocker", () => {
  const board = addBoard(addBoard([], { kind: "fact", text: "https://10.0.0.120/ui/" }), {
    kind: "blocker",
    text: "TLS on browser",
  });
  expect(parseBoard(board.map((item) => `- [${item.kind}] ${item.text}`).join("\n"))).toHaveLength(2);
  const idle = nextIdleWork({
    samostPresent: true,
    samost: seedSamost(),
    existence: [],
    board,
    rules: [],
  });
  expect(idle.item).toBe("board_to_existence");
});
