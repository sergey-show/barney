#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import {
  estimateTransferEffect,
  type TransferObservation,
} from "../../application/evaluation/counterfactualTransfer.ts";
import { getKernel } from "../../composition/Kernel.ts";
import { KernelAgentSessionApplication } from "../../composition/KernelAgentSessionApplication.ts";
import type { RunSnapshot } from "../../domain/run/Run.ts";
import { runAcp } from "../acp/server.ts";
import { startWeb } from "../http/server.ts";
import { createLivePrinter, printBanner, printError, printMeta, printPrompt, printSection, printStatus, printTranscript, printWork } from "./render.ts";
import { openTui } from "./tui.ts";

const web = defineCommand({
  meta: { name: "web", description: "Start the two-pane web portal" },
  args: {
    port: { type: "string", default: "7331" },
    host: { type: "string", default: "127.0.0.1" },
    open: { type: "boolean", default: true },
  },
  async run({ args }) {
    await startWeb({ port: Number(args.port), host: args.host, open: args.open });
  },
});

const acp = defineCommand({
  meta: { name: "acp", description: "Serve ACP v1 over stdio" },
  async run() {
    await runAcp(new KernelAgentSessionApplication(getKernel()));
  },
});

const transfer = defineCommand({
  meta: { name: "transfer", description: "Estimate paired causal transfer from observations" },
  args: {
    observations: { type: "positional", required: true, description: "JSON observations file" },
  },
  async run({ args }) {
    const source = String(args.observations);
    const parsed = await Bun.file(source).json() as TransferObservation[] | { observations: TransferObservation[] };
    const observations = Array.isArray(parsed) ? parsed : parsed.observations;
    if (!Array.isArray(observations)) throw new Error("observations JSON must contain an array");
    console.log(JSON.stringify(estimateTransferEffect(observations), null, 2));
  },
});

const CLI_HELP = [
  "TASKS",
  "  /new                 start a clean task",
  "  /sessions [query]    find previous sessions",
  "  /open <id-prefix>    open a previous session",
  "  /continue            continue interrupted work",
  "  /retry               retry the last request",
  "  /close               close the current session",
  "",
  "KNOWLEDGE",
  "  /memory [query]      browse notes and learned lessons",
  "  /note <key>          open a complete memory note",
  "  /agents              list agents",
  "  /agent <name>        choose the agent for the next task",
  "",
  "CONTROL",
  "  /work                expand or collapse activity",
  "  /status              show task status and workspace",
  "  /allow <path>        grant access outside the workspace",
  "  /debug               show internal transcript in plain mode",
  "  /stop                stop an active step (Ctrl+C also stops it)",
  "  /quit                exit",
].join("\n");

const TUI_HELP = [
  "TASKS      /new  /sessions [query]  /open <id>  /continue  /retry  /close",
  "KNOWLEDGE  /memory [query]  /note <key>  /agents  /agent <name>",
  "CONTROL    /work  /status  /allow <path>  /debug  /quit",
  "STOP       Press Ctrl+C while Barney is working.",
].join("\n");

function sessionTime(run: RunSnapshot): number {
  const value = run.transcript.at(-1)?.at;
  const time = value ? Date.parse(value) : 0;
  return Number.isFinite(time) ? time : 0;
}

const cli = defineCommand({
  meta: { name: "cli", description: "Interactive CLI against the same kernel" },
  args: {
    agent: { type: "string", description: "Agent id or name" },
  },
  async run({ args }) {
    const kernel = getKernel();
    const sessions = new KernelAgentSessionApplication(kernel);
    const agents = await kernel.listAgents();
    const state = await kernel.providerState();
    const coder = state.bindings.find((b) => b.role === "coder");
    const model = coder ? `${state.providers.find((p) => p.id === coder.providerId)?.name ?? "provider"} / ${coder.model}` : undefined;
    let agent = agents.find((a) => a.id.value === args.agent || a.name === args.agent) ?? agents[0];
    const headline = `${agent.name} v${agent.version}`;
    let runId: string | undefined;
    let current: RunSnapshot | undefined;
    const tui = openTui({
      agent: headline,
      model,
      onInterrupt: () => {
        if (runId) sessions.cancel(runId);
      },
    });
    if (!tui) printBanner(headline, model);

    let seen = 0;
    let debug = false;
    const again = () => {
      if (tui) tui.prompt();
      else printPrompt();
    };
    const note = (kind: string, text: string) => {
      if (tui) tui.log(kind, text);
      else if (kind === "error") printError(text);
      else printMeta(kind, text);
    };
    if (tui) {
      tui.log(
        "system",
        model
          ? "Ready. Describe a task, or use /help to explore sessions, memory, and controls."
          : "No model is configured. Run /quit, then configure one with `barney providers add … --use`.",
      );
    }
    again();
    try {
    for await (const raw of console) {
      const line = String(raw).trim();
      if (line === "/quit") break;
      if (!line) { again(); continue; }
      if (line === "/help" || line === "/?") {
        note("meta", tui ? TUI_HELP : CLI_HELP);
        again();
        continue;
      }
      if (line === "/new") {
        runId = undefined;
        current = undefined;
        seen = 0;
        tui?.setSession("");
        tui?.setChat([]);
        tui?.setStatus("ready for a new task");
        note("meta", "New task ready. Your next message becomes its goal.");
        again();
        continue;
      }
      if (line === "/debug") {
        debug = !debug;
        note("debug", debug ? "on" : "off");
        again();
        continue;
      }
      if (line === "/work") {
        const work = current?.transcript.filter((item) => item.kind !== "user" && item.kind !== "assistant") ?? [];
        if (tui) {
          tui.toggleWork();
          again();
          continue;
        }
        if (!work.length) printSection("work", []);
        else printWork(work, true);
        printPrompt();
        continue;
      }
      if (line === "/agents") {
        const rows = (await kernel.listAgents()).map((a) => `${a.name}  v${a.version}`);
        if (tui) note("meta", rows.join(" · ") || "none");
        else printSection("agents", rows);
        again();
        continue;
      }
      if (line.startsWith("/agent ")) {
        const wanted = line.slice(7).trim().toLowerCase();
        const found = (await kernel.listAgents()).find((item) =>
          item.id.value.toLowerCase().startsWith(wanted) || item.name.toLowerCase() === wanted
        );
        if (!found) note("error", `Agent not found: ${wanted}`);
        else {
          agent = found;
          note("success", `Next task will use ${agent.name} v${agent.version}.`);
        }
        again();
        continue;
      }
      if (line === "/memory" || line.startsWith("/memory ")) {
        const query = line.slice(7).trim();
        const notes = await kernel.listMemory(query, 12);
        const rows = notes.map((item) => tui
          ? `${item.title.slice(0, 42)}  ·  ${item.key}`
          : `${item.title}\n  ${item.key} · ${item.tags.slice(0, 3).join(", ")}`
        );
        if (tui) note("meta", [...rows.slice(0, 8), "", "Use /note <key> to open the full note."].join("\n"));
        else printSection("memory", rows);
        again();
        continue;
      }
      if (line.startsWith("/note ")) {
        const key = line.slice(6).trim();
        const memory = await kernel.getMemory(key);
        if (!memory) note("error", `Note not found: ${key}`);
        else note("meta", `${memory.title}\n${memory.body}`);
        again();
        continue;
      }
      if (line === "/sessions" || line === "/runs" || line.startsWith("/sessions ")) {
        const query = line.startsWith("/sessions ") ? line.slice(10).trim().toLowerCase() : "";
        const allRuns = (await sessions.list())
          .filter((run) => !query || `${run.id} ${run.status} ${run.goal}`.toLowerCase().includes(query))
          .sort((a, b) => sessionTime(b) - sessionTime(a));
        const rows = allRuns.slice(0, 8).map((run) =>
          `${run.status.padEnd(10)}  ${run.id.slice(0, 12)}  ${run.goal.slice(0, 54)}`
        );
        const footer = `${allRuns.length > 8 ? `Showing 8 of ${allRuns.length}. ` : ""}Use /open <id-prefix> or /sessions <query>.`;
        if (tui) note("meta", [...(rows.length ? rows : ["none"]), "", footer].join("\n"));
        else {
          printSection("sessions", rows);
          printMeta("tip", footer);
        }
        again();
        continue;
      }
      if (line.startsWith("/open ")) {
        const wanted = line.slice(6).trim().toLowerCase();
        const found = (await sessions.list()).find((run) => run.id.toLowerCase().startsWith(wanted));
        if (!found) {
          note("error", `Session not found: ${wanted}`);
        } else {
          runId = found.id;
          current = found;
          seen = found.transcript.length;
          tui?.setSession(found.id, found.worktreePath, found.sessionPath);
          tui?.setChat(found.transcript);
          tui?.setStatus(`${found.status} · ${found.attempts} attempts`);
          if (!tui) printTranscript(found.transcript, { debug });
        }
        again();
        continue;
      }
      if (line === "/status") {
        if (!current) note("session", "No active session. Send a task or use /open.");
        else note("meta", [
          `${current.status} · ${current.attempts} attempts · ${current.tokensUsed} tokens`,
          current.goal,
          current.worktreePath,
        ].join("\n"));
        again();
        continue;
      }
      if (line === "/stop") {
        note("meta", runId && sessions.cancel(runId).ok ? "Stopping the active step…" : "No step is running.");
        again();
        continue;
      }
      if (line === "/close") {
        if (!runId) note("session", "No active session.");
        else {
          current = await sessions.close(runId);
          tui?.setStatus("done");
          note("success", "Session closed. Use /new for another task.");
        }
        again();
        continue;
      }
      if (line.startsWith("/form")) {
        if (!runId) { note("session", "none"); again(); continue; }
        const name = line.slice(5).trim() || undefined;
        const result = await kernel.formFromRun(runId, name);
        note("form", `${result.decision} → ${result.agent.name} v${result.agent.version}`);
        again();
        continue;
      }
      if (line.startsWith("/allow")) {
        if (!runId) { note("session", "none"); again(); continue; }
        const path = line.slice(6).trim();
        if (!path) {
          note("permission", "usage: /allow /path/prefix");
          again();
          continue;
        }
        try {
          const prefix = await kernel.grantOutside(runId, path);
          note("permission", `allowed ${prefix}`);
          current = await sessions.get(runId) ?? current;
          if (tui && current) tui.setChat(current.transcript);
        } catch (err) {
          note("error", String(err));
        }
        again();
        continue;
      }
      if (line === "/continue" || line === "/retry") {
        if (!runId) { note("session", "none"); again(); continue; }
        const live = tui ? tui.livePrinter(() => runId) : createLivePrinter(() => runId);
        const off = sessions.subscribe((event) => live.onEvent(event.type, event.payload));
        try {
          current = await sessions.resume(runId, line === "/retry" ? "retry" : "continue");
        } catch (err) {
          note("error", String(err));
          again();
          continue;
        } finally {
          off();
          live.finish();
        }
        if (!current) { again(); continue; }
        if (tui) {
          tui.setChat(current.transcript);
          tui.setStatus(current.status);
        } else {
          printTranscript(current.transcript.slice(seen), { debug });
          printStatus(current.status, current.attempts);
        }
        seen = current.transcript.length;
        again();
        continue;
      }
      try {
        if (!runId) {
          const created = await sessions.create({ goal: line, agentId: agent.id.value, cwd: process.cwd() });
          runId = created.id;
          seen = created.transcript.length;
          if (tui) tui.setSession(runId, created.worktreePath, created.sessionPath);
          else {
            printMeta("session", runId);
            printMeta("worktree", created.worktreePath);
            if (created.sessionPath !== created.worktreePath) printMeta("dir", created.sessionPath);
            console.log();
          }
        }
        if (tui) tui.log("user", line);
        const live = tui ? tui.livePrinter(() => runId) : createLivePrinter(() => runId);
        const off = sessions.subscribe((event) => live.onEvent(event.type, event.payload));
        try {
          current = await sessions.prompt(runId, line);
        } finally {
          off();
          live.finish();
        }
        if (tui) {
          tui.setChat(current.transcript);
          tui.setStatus(`${current.status}${current.attempts ? ` · ${current.attempts}` : ""}`);
        } else {
          const fresh = current.transcript.slice(seen);
          const skip = fresh[0]?.kind === "user" && fresh[0].text === line ? 1 : 0;
          printTranscript(fresh.slice(skip), { debug });
          printStatus(current.status, current.attempts);
        }
        seen = current.transcript.length;
      } catch (err) {
        note("error", String(err));
      }
      again();
    }
    } finally {
      tui?.close();
    }
  },
});

const run = defineCommand({
  meta: { name: "run", description: "One-shot run" },
  args: {
    agent: { type: "string" },
    goal: { type: "positional", required: true },
  },
  async run({ args }) {
    const kernel = getKernel();
    const agents = await kernel.listAgents();
    const state = await kernel.providerState();
    const coder = state.bindings.find((b) => b.role === "coder");
    const model = coder ? `${state.providers.find((p) => p.id === coder.providerId)?.name ?? "provider"} / ${coder.model}` : undefined;
    const agent = agents.find((a) => a.id.value === args.agent || a.name === args.agent) ?? agents[0];
    const created = await kernel.createRun(String(args.goal), agent?.id.value, process.cwd());
    printBanner(`${agent?.name ?? "Barney"}${agent ? ` v${agent.version}` : ""}`, model);
    printMeta("session", created.id.value);
    printMeta("worktree", created.worktreePath);
    if (created.sessionPath !== created.worktreePath) printMeta("dir", created.sessionPath);
    console.log();
    const live = createLivePrinter(() => created.id.value);
    const off = kernel.events.subscribe((event) => live.onEvent(event.type, event.payload));
    try {
      const run = await kernel.send(created.id.value, String(args.goal));
      live.finish();
      printTranscript(run.transcript);
      printStatus(run.status, run.attempts);
    } finally {
      off();
    }
  },
});

const agentsCmd = defineCommand({
  meta: { name: "agents", description: "List or form agents" },
  subCommands: {
    ls: defineCommand({
      meta: { name: "ls" },
      async run() {
        printSection(
          "agents",
          (await getKernel().listAgents()).map((a) => `${a.name}  v${a.version}  ${a.taskClass}`),
        );
      },
    }),
    save: defineCommand({
      meta: { name: "save" },
      args: {
        fromRun: { type: "string", required: true },
        name: { type: "string" },
      },
      async run({ args }) {
        const result = await getKernel().formFromRun(String(args.fromRun), args.name ? String(args.name) : undefined);
        printMeta("form", `${result.decision} → ${result.agent.name} v${result.agent.version}`);
      },
    }),
  },
});

const providersCmd = defineCommand({
  meta: { name: "providers", description: "OpenAI-compatible and built-in providers" },
  subCommands: {
    ls: defineCommand({
      meta: { name: "ls" },
      async run() {
        const state = await getKernel().providerState();
        const active = state.bindings.find((b) => b.role === "coder");
        printSection(
          "providers",
          state.providers.map((p) => {
            const mark = active?.providerId === p.id ? "●" : " ";
            return `${mark} ${p.name}  ${p.dialect}  ${p.defaultModel ?? "-"}  key=${p.hasKey ? "yes" : "no"}`;
          }),
        );
        if (state.lanes.large) printMeta("model", `${state.lanes.large.model}`);
      },
    }),
    add: defineCommand({
      meta: { name: "add", description: "Add an OpenAI-compatible host" },
      args: {
        name: { type: "string", required: true },
        host: { type: "string", required: true, description: "http://127.0.0.1:1234 or .../v1" },
        key: { type: "string", description: "API key, optional" },
        dialect: { type: "string", description: "llamacpp | ollama | vllm | openai-custom | openai | groq | openrouter" },
        use: { type: "boolean", default: false },
      },
      async run({ args }) {
        const kernel = getKernel();
        const provider = await kernel.addOpenAiProvider({
          name: String(args.name),
          host: String(args.host),
          apiKey: args.key ? String(args.key) : undefined,
          dialect: args.dialect ? String(args.dialect) : undefined,
        });
        printMeta("provider", `${provider.name}  ${provider.dialect}  ${provider.baseUrl}`);
        if (args.use) {
          const used = await kernel.useProvider(provider.id);
          printMeta("coder", `${used.provider.name} / ${used.model}`);
        }
      },
    }),
    models: defineCommand({
      meta: { name: "models" },
      args: { id: { type: "positional", required: true } },
      async run({ args }) {
        printSection("models", await getKernel().refreshModels(String(args.id)));
      },
    }),
    use: defineCommand({
      meta: { name: "use", description: "Bind the model for plan, act, and review" },
      args: {
        id: { type: "positional", required: true },
        model: { type: "string", description: "Model id from /v1/models" },
      },
      async run({ args }) {
        const kernel = getKernel();
        const used = await kernel.useProvider(String(args.id), args.model ? String(args.model) : undefined);
        printMeta("model", `${used.provider.name} / ${used.model}`);
      },
    }),
    rm: defineCommand({
      meta: { name: "rm" },
      args: { id: { type: "positional", required: true } },
      async run({ args }) {
        await getKernel().removeProvider(String(args.id));
        printMeta("provider", "removed");
      },
    }),
  },
});

const main = defineCommand({
  meta: { name: "barney", description: "Self-extending agent kernel" },
  subCommands: { web, acp, transfer, cli, run, agents: agentsCmd, providers: providersCmd },
});

await runMain(main);
