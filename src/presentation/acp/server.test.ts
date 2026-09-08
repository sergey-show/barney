import { expect, test } from "bun:test";
import type * as acp from "@agentclientprotocol/sdk";
import type { AgentSessionApplication } from "../../application/surfaces/AgentSessionApplication.ts";
import type { RunSnapshot } from "../../domain/run/Run.ts";
import { BarneyAcpAgent } from "./server.ts";

test("ACP creates a Barney run on the first prompt and reuses it", async () => {
  const calls: string[] = [];
  let snapshot = runSnapshot("run-1", []);
  const application = fakeApplication({
    async create(input) {
      calls.push(`create:${input.cwd}:${input.goal}`);
      snapshot = runSnapshot("run-1", [item("system", "started")]);
      return snapshot;
    },
    async prompt(_id, text) {
      calls.push(`prompt:${text}`);
      snapshot = runSnapshot("run-1", [
        ...snapshot.transcript,
        item("user", text),
        item("assistant", `reply:${text}`),
      ]);
      return snapshot;
    },
    async get() {
      return snapshot;
    },
  });
  const agent = new BarneyAcpAgent(application);
  const { sessionId } = agent.newSession({ cwd: "/tmp/project", mcpServers: [] });
  const updates: acp.SessionNotification[] = [];
  const context = {
    async notify(_method: "session/update", params: acp.SessionNotification) {
      updates.push(params);
    },
  };

  await agent.prompt({ sessionId, prompt: [{ type: "text", text: "first" }] }, context);
  await agent.prompt({ sessionId, prompt: [{ type: "text", text: "second" }] }, context);

  expect(calls.filter((call) => call.startsWith("create:"))).toHaveLength(1);
  expect(calls).toContain("prompt:first");
  expect(calls).toContain("prompt:second");
  expect(updates.filter((update) => update.update.sessionUpdate === "agent_message_chunk")).toHaveLength(2);
});

test("ACP cancellation delegates to the shared session application", () => {
  let cancelled = "";
  const application = fakeApplication({
    cancel(id) {
      cancelled = id;
      return { ok: true };
    },
  });
  const agent = new BarneyAcpAgent(application);
  const { sessionId } = agent.newSession({ cwd: "/tmp/project", mcpServers: [] });

  // A first prompt is required before an ACP session owns a Barney run.
  return agent.prompt(
    { sessionId, prompt: [{ type: "text", text: "work" }] },
    { async notify() {} },
  ).then(() => {
    agent.cancel({ sessionId });
    expect(cancelled).toBe("run-1");
  });
});

test("ACP rejects unsupported prompt content and concurrent prompts", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const application = fakeApplication({
    async prompt() {
      await blocked;
      return runSnapshot("run-1", [item("assistant", "done")]);
    },
  });
  const agent = new BarneyAcpAgent(application);
  const firstSession = agent.newSession({ cwd: "/tmp/project", mcpServers: [] }).sessionId;
  await expect(agent.prompt(
    {
      sessionId: firstSession,
      prompt: [{ type: "image", data: "AA==", mimeType: "image/png" }],
    },
    { async notify() {} },
  )).rejects.toThrow(/Invalid params/i);

  const sessionId = agent.newSession({ cwd: "/tmp/project", mcpServers: [] }).sessionId;
  const first = agent.prompt(
    { sessionId, prompt: [{ type: "text", text: "first" }] },
    { async notify() {} },
  );
  await Promise.resolve();
  await expect(agent.prompt(
    { sessionId, prompt: [{ type: "text", text: "second" }] },
    { async notify() {} },
  )).rejects.toThrow(/Invalid request/i);
  release();
  await first;
});

test("ACP reports a completed failed Barney turn as end_turn, not refusal", async () => {
  const application = fakeApplication({
    async prompt() {
      return runSnapshot("run-1", [item("assistant", "could not complete")], "failed");
    },
  });
  const agent = new BarneyAcpAgent(application);
  const { sessionId } = agent.newSession({ cwd: "/tmp/project", mcpServers: [] });
  const response = await agent.prompt(
    { sessionId, prompt: [{ type: "text", text: "work" }] },
    { async notify() {} },
  );
  expect(response.stopReason).toBe("end_turn");
});

function fakeApplication(
  patch: Partial<AgentSessionApplication>,
): AgentSessionApplication {
  const base: AgentSessionApplication = {
    async create() {
      return runSnapshot("run-1", [item("system", "started")]);
    },
    async prompt(_id, text) {
      return runSnapshot("run-1", [item("assistant", `reply:${text}`)]);
    },
    async resume() {
      return runSnapshot("run-1", []);
    },
    async close() {
      return runSnapshot("run-1", []);
    },
    async get() {
      return runSnapshot("run-1", []);
    },
    async list() {
      return [];
    },
    cancel() {
      return { ok: false };
    },
    isRunning() {
      return false;
    },
    subscribe() {
      return () => {};
    },
  };
  return { ...base, ...patch };
}

function runSnapshot(
  id: string,
  transcript: RunSnapshot["transcript"],
  status: RunSnapshot["status"] = "ready",
): RunSnapshot {
  return {
    id,
    agentId: "agent-1",
    goal: "goal",
    taskClass: "general",
    status,
    worktreePath: "/tmp/project",
    sessionPath: "/tmp/project",
    attempts: 1,
    usedStrategies: [],
    failedPlanHashes: [],
    lastPlanHash: null,
    lastFailureMode: null,
    sameFailureCount: 0,
    distinctStrategies: 0,
    transcript,
    tokensUsed: 0,
    usdUsed: 0,
  };
}

function item(kind: RunSnapshot["transcript"][number]["kind"], text: string) {
  return { id: crypto.randomUUID(), kind, text, at: new Date().toISOString() };
}
