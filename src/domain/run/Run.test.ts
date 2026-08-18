import { Agent } from "../agent/Agent.ts";
import { DomainError } from "../shared/DomainError.ts";
import { Run } from "./Run.ts";

function assertStatus(actual: string, expected: string): void {
  if (actual !== expected) throw new Error(`expected ${expected}, got ${actual}`);
}

const agent = Agent.create({ name: "t" });
const run = Run.start(agent, { goal: "what time", worktreePath: "/tmp/ws" });
run.beginAct("retry_with_error", "what time");
run.finishAct("noon", 10, 0, { tokens: 10, ms: 1200, model: "stub" });
const noon = run.transcript.find((item) => item.kind === "assistant" && item.text === "noon");
if (!noon?.meta || noon.meta.tokens !== 10 || noon.meta.model !== "stub") throw new Error("reply meta missing");
run.submitReview({ verdict: "pass", summary: "ok", needsResearch: false });
assertStatus(run.status, "ready");

run.beginAct("retry_with_error", "use date");
run.finishAct("used date", 10, 0);
run.submitReview({ verdict: "pass", summary: "ok", needsResearch: false });
assertStatus(run.status, "ready");

const live = Run.start(agent, { goal: "stop me", worktreePath: "/tmp/ws2" });
live.beginAct("retry_with_error", "long");
live.interrupt();
assertStatus(live.status, "ready");
live.beginAct("retry_with_error", "again after stop");
assertStatus(live.status, "acting");
live.interrupt("Portal restarted; last step was interrupted.");
assertStatus(live.status, "ready");
if (!live.transcript.at(-1)?.text.includes("Portal restarted")) throw new Error("interrupt reason");

run.close();
assertStatus(run.status, "done");
try {
  run.beginAct("retry_with_error", "again");
  throw new Error("closed session accepted an act");
} catch (err) {
  if (!(err instanceof DomainError) || err.code !== "run_closed") throw err;
}
console.log("run session stays open until close");
