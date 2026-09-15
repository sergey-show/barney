import { expect, test } from "bun:test";
import {
  AGENDA_MIN_GAP_COUNT,
  gapsFromBacklogRows,
  gapsFromFailEpisodes,
  markAgenda,
  mergeAgenda,
  nextPending,
  parseAgenda,
  proposeAgendaItem,
  formatAgenda,
} from "./agenda.ts";
import { nextIdleWork, SELF_RUN_IDLE_MS } from "../psyche/idleTick.ts";
import { seedSamost } from "../psyche/samost.ts";

test("gaps require repeated failure modes", () => {
  expect(gapsFromBacklogRows([{ klass: "secret-leak", count: 1 }])).toHaveLength(0);
  expect(gapsFromBacklogRows([{ klass: "secret-leak", count: AGENDA_MIN_GAP_COUNT }])).toHaveLength(1);
  expect(gapsFromFailEpisodes([
    { outcome: "fail", failureMode: "missing-artifact", nextHint: "write the file" },
    { outcome: "fail", failureMode: "missing-artifact", nextHint: "write the file first" },
  ])).toHaveLength(1);
});

test("proposeAgendaItem builds a local drill goal", () => {
  const item = proposeAgendaItem({
    failClass: "secret-leak",
    hint: "do not echo live keys",
    count: 2,
    source: "backlog",
  });
  expect(item.status).toBe("pending");
  expect(item.goal).toContain("recovery-secret-leak.md");
  expect(item.goal).toContain("What failed");
});

test("mergeAgenda dedupes by class and nextPending respects order", () => {
  const a = proposeAgendaItem({ failClass: "secret-leak", hint: "a", count: 2, source: "backlog" });
  const b = proposeAgendaItem({ failClass: "secret-leak", hint: "b", count: 3, source: "episode" });
  const c = proposeAgendaItem({ failClass: "missing-artifact", hint: "c", count: 2, source: "episode" });
  const merged = mergeAgenda([], [a, b, c]);
  expect(merged).toHaveLength(2);
  expect(nextPending(merged)?.failClass).toBe("secret-leak");
  const running = markAgenda(merged, a.id, { status: "running", runId: "r1" });
  expect(nextPending(running)?.failClass).toBe("missing-artifact");
  expect(parseAgenda(formatAgenda(running))).toHaveLength(2);
});

test("idle prefers self_run over study when agenda is pending", () => {
  const work = nextIdleWork({
    samostPresent: true,
    samost: seedSamost(),
    existence: [],
    board: [],
    rules: [],
    idleMs: SELF_RUN_IDLE_MS,
    failHints: ["TLS on browser login"],
    studied: [],
    studyCooldownMs: SELF_RUN_IDLE_MS,
    selfRunCooldownMs: SELF_RUN_IDLE_MS,
    pendingSelfRun: {
      agendaId: "drill-secret-leak",
      goal: "Autonomy drill for secret-leak",
      failClass: "secret-leak",
    },
  });
  expect(work).toEqual({
    item: "self_run",
    agendaId: "drill-secret-leak",
    goal: "Autonomy drill for secret-leak",
    failClass: "secret-leak",
  });
});
