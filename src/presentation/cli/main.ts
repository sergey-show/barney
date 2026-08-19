#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { getKernel } from "../../composition/Kernel.ts";
import type { Run } from "../../domain/run/Run.ts";
import { startWeb } from "../http/server.ts";
import { createLivePrinter, printBanner, printError, printMeta, printPrompt, printSection, printStatus, printTranscript, printWork } from "./render.ts";

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

const cli = defineCommand({
  meta: { name: "cli", description: "Interactive CLI against the same kernel" },
  args: {
    agent: { type: "string", description: "Agent id or name" },
  },
  async run({ args }) {
    const kernel = getKernel();
    const agents = await kernel.listAgents();
    const state = await kernel.providerState();
    const coder = state.bindings.find((b) => b.role === "coder");
    const model = coder ? `${state.providers.find((p) => p.id === coder.providerId)?.name ?? "provider"} / ${coder.model}` : undefined;
    let agent = agents.find((a) => a.id.value === args.agent || a.name === args.agent) ?? agents[0];
    printBanner(`${agent.name} v${agent.version}`, model);

    let runId: string | undefined;
    let current: Run | undefined;
    let seen = 0;
    let debug = false;
    printPrompt();
    for await (const raw of console) {
      const line = String(raw).trim();
      if (line === "/quit") break;
      if (!line) { printPrompt(); continue; }
      if (line === "/debug") {
        debug = !debug;
        printMeta("debug", debug ? "on" : "off");
        printPrompt();
        continue;
      }
      if (line === "/work") {
        const work = current?.transcript.filter((item) => item.kind !== "user" && item.kind !== "assistant") ?? [];
        if (!work.length) printSection("work", []);
        else printWork(work, true);
        printPrompt();
        continue;
      }
      if (line === "/agents") {
        printSection("agents", (await kernel.listAgents()).map((a) => `${a.name}  v${a.version}`));
        printPrompt();
        continue;
      }
      if (line === "/memory" || line.startsWith("/memory ")) {
        const query = line.slice(7).trim();
        const notes = query ? await kernel.memories.search(query, 12) : await kernel.memories.recent(12);
        printSection("memory", notes.map((note) => `${note.key}  ${note.title}`));
        printPrompt();
        continue;
      }
      if (line === "/sessions" || line === "/runs") {
        printSection("sessions", (await kernel.listRuns()).map((r) => `${r.status.padEnd(10)}  ${r.goal.slice(0, 64)}`));
        printPrompt();
        continue;
      }
      if (line.startsWith("/form")) {
        if (!runId) { printMeta("session", "none"); printPrompt(); continue; }
        const name = line.slice(5).trim() || undefined;
        const result = await kernel.formFromRun(runId, name);
        printMeta("form", `${result.decision} → ${result.agent.name} v${result.agent.version}`);
        printPrompt();
        continue;
      }
      if (line === "/continue" || line === "/retry") {
        if (!runId) { printMeta("session", "none"); printPrompt(); continue; }
        const live = createLivePrinter(() => runId);
        const off = kernel.events.subscribe((event) => live.onEvent(event.type, event.payload));
        try {
          current = await kernel.resume(runId, line === "/retry" ? "retry" : "continue");
        } catch (err) {
          printError(String(err));
          printPrompt();
          continue;
        } finally {
          off();
          live.finish();
        }
        if (!current) { printPrompt(); continue; }
        printTranscript(current.transcript.slice(seen), { debug });
        printStatus(current.status, current.attempts);
        seen = current.transcript.length;
        printPrompt();
        continue;
      }
      try {
        if (!runId) {
          const created = await kernel.createRun(line, agent.id.value);
          runId = created.id.value;
          seen = created.transcript.length;
          printMeta("session", runId);
          printMeta("worktree", created.worktreePath);
          console.log();
        }
        const live = createLivePrinter(() => runId);
        const off = kernel.events.subscribe((event) => live.onEvent(event.type, event.payload));
        try {
          current = await kernel.send(runId, line);
        } finally {
          off();
          live.finish();
        }
        const fresh = current.transcript.slice(seen);
        const skip = fresh[0]?.kind === "user" && fresh[0].text === line ? 1 : 0;
        printTranscript(fresh.slice(skip), { debug });
        printStatus(current.status, current.attempts);
        seen = current.transcript.length;
      } catch (err) {
        printError(String(err));
      }
      printPrompt();
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
    const created = await kernel.createRun(String(args.goal), agent?.id.value);
    printBanner(`${agent?.name ?? "Barney"}${agent ? ` v${agent.version}` : ""}`, model);
    printMeta("session", created.id.value);
    printMeta("worktree", created.worktreePath);
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
        if (state.lanes.large) printMeta("large", `${state.lanes.large.model}`);
        if (state.lanes.small) printMeta("small", `${state.lanes.small.model}`);
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
      meta: { name: "use", description: "Bind large (coder) and optional small (reviewer) models" },
      args: {
        id: { type: "positional", required: true },
        model: { type: "string", description: "Large model — coder, researcher" },
        fast: { type: "string", description: "Small model — planner, reviewer, embedder" },
        fastProvider: { type: "string", description: "Provider for the small model, if different" },
      },
      async run({ args }) {
        const kernel = getKernel();
        if (args.fast) {
          const state = await kernel.useLanes({
            large: { providerId: String(args.id), model: args.model ? String(args.model) : undefined },
            small: {
              providerId: args.fastProvider ? String(args.fastProvider) : String(args.id),
              model: String(args.fast),
            },
          });
          printMeta("large", `${state.lanes.large?.model ?? "-"}`);
          printMeta("small", `${state.lanes.small?.model ?? "-"}`);
          return;
        }
        const used = await kernel.useProvider(String(args.id), args.model ? String(args.model) : undefined);
        printMeta("coder", `${used.provider.name} / ${used.model}`);
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
  subCommands: { web, cli, run, agents: agentsCmd, providers: providersCmd },
});

await runMain(main);
