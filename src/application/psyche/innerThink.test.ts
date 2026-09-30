import { expect, test } from "bun:test";
import { nextIdleWork, SELF_RUN_IDLE_MS } from "./idleTick.ts";
import {
  INNER_THINK_COOLDOWN_MS,
  INNER_THINK_IDLE_MS,
  INNER_THINK_WAITING_COOLDOWN_MS,
  applyInnerThinkBoard,
  innerThinkLocalFallback,
  parseInnerThink,
} from "./innerThink.ts";
import { seedSamost } from "./samost.ts";

test("waiting on wake schedules inner_think before study", () => {
  const work = nextIdleWork({
    samostPresent: true,
    samost: seedSamost(),
    existence: [],
    board: [{ kind: "motive", text: "wait for build" }],
    rules: [],
    waitingOnWake: true,
    innerThinkCooldownMs: INNER_THINK_WAITING_COOLDOWN_MS,
  });
  expect(work).toEqual({ item: "inner_think", reason: "waiting" });
});

test("idle inner_think needs material and cooldown", () => {
  const blank = {
    compass: "x",
    character: [] as string[],
    light: [] as string[],
    shadow: [] as string[],
  };
  const empty = nextIdleWork({
    samostPresent: true,
    samost: blank,
    existence: [],
    board: [],
    rules: [],
    idleMs: INNER_THINK_IDLE_MS,
    innerThinkCooldownMs: INNER_THINK_COOLDOWN_MS,
  });
  expect(empty.item).toBe("none");

  const withShadow = {
    ...blank,
    shadow: ["openssl family failed — prefer python next time on this class"],
  };
  const work = nextIdleWork({
    samostPresent: true,
    samost: withShadow,
    existence: [],
    board: [],
    rules: [],
    idleMs: INNER_THINK_IDLE_MS,
    innerThinkCooldownMs: INNER_THINK_COOLDOWN_MS,
  });
  expect(work).toEqual({ item: "inner_think", reason: "idle" });
});

test("self_run still beats idle inner_think when pending", () => {
  const samost = seedSamost();
  samost.shadow.push("something long enough to think about later");
  const work = nextIdleWork({
    samostPresent: true,
    samost,
    existence: [],
    board: [],
    rules: [],
    idleMs: SELF_RUN_IDLE_MS,
    selfRunCooldownMs: SELF_RUN_IDLE_MS,
    innerThinkCooldownMs: INNER_THINK_COOLDOWN_MS,
    pendingSelfRun: {
      agendaId: "drill-x",
      goal: "Write recovery-x.md",
      failClass: "x",
    },
  });
  expect(work.item).toBe("self_run");
});

test("parseInnerThink and local fallback", () => {
  const parsed = parseInnerThink(
    `{"thoughts":"Check logs before retrying.","board":[{"kind":"blocker","text":"build still running"},{"kind":"motive","text":"hack"}],"note":"prefer process_logs"}`,
  );
  expect(parsed.thoughts).toMatch(/logs/i);
  expect(parsed.board).toHaveLength(1);
  expect(parsed.board[0]?.kind).toBe("blocker");
  expect(parsed.note).toMatch(/process_logs/);

  const local = innerThinkLocalFallback({
    shadow: ["do not hammer openssl"],
    board: [],
  });
  expect(local.thoughts).toMatch(/Rehearse/);
  const board = applyInnerThinkBoard([], local.board);
  expect(board.some((e) => e.kind === "note")).toBe(true);
});
