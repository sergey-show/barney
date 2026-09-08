import { Hono } from "hono";
import { cors } from "hono/cors";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { getKernel } from "../../composition/Kernel.ts";
import { KernelAgentSessionApplication } from "../../composition/KernelAgentSessionApplication.ts";
import type { AgentSessionApplication } from "../../application/surfaces/AgentSessionApplication.ts";
import type { RunSnapshot } from "../../domain/run/Run.ts";
import type { DomainEvent } from "../../domain/shared/DomainEvent.ts";
import { visibleAssistantText } from "../../infrastructure/llm/visibleReply.ts";

const clients = new Set<{ send: (data: string) => void }>();

export function createApp() {
  const app = new Hono();
  const kernel = getKernel();
  const sessions = new KernelAgentSessionApplication(kernel);
  app.use("*", cors());

  kernel.events.subscribe((event: DomainEvent) => {
    const payload = JSON.stringify({ type: "event", event });
    for (const client of clients) client.send(payload);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/agents", async (c) => {
    const agents = await kernel.listAgents();
    return c.json(agents.map((a) => a.snapshot()));
  });

  app.post("/api/agents", async (c) => {
    const body = await c.req.json<{ name: string; constitution?: string; taskClass?: string }>();
    const { Agent } = await import("../../domain/agent/Agent.ts");
    const agent = Agent.create({ name: kernel.mask(body.name), constitution: body.constitution, taskClass: body.taskClass });
    await kernel.agents.save(agent);
    return c.json(agent.snapshot());
  });

  mountSessionRoutes(app, kernel, sessions, "/api/sessions");
  mountSessionRoutes(app, kernel, sessions, "/api/runs");

  app.get("/api/providers", async (c) => {
    return c.json(await kernel.providerState());
  });

  app.post("/api/providers", async (c) => {
    try {
      const body = await c.req.json<{ name: string; host: string; apiKey?: string; dialect?: string }>();
      return c.json(await kernel.addOpenAiProvider({
        name: body.name,
        host: body.host,
        apiKey: body.apiKey,
        dialect: body.dialect,
      }));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get("/api/providers/:id/models", async (c) => {
    const models = await kernel.refreshModels(c.req.param("id"));
    return c.json({ models });
  });

  app.patch("/api/providers/:id", async (c) => {
    try {
      const body = await c.req.json<{ name?: string; host?: string; apiKey?: string | null; dialect?: string }>();
      return c.json(await kernel.updateProvider(c.req.param("id"), body));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.post("/api/providers/:id/use", async (c) => {
    const body = await c.req.json<{ model?: string }>().catch(() => ({ model: undefined }));
    return c.json(await kernel.useProvider(c.req.param("id"), body.model));
  });

  app.post("/api/lanes", async (c) => {
    try {
      const body = await c.req.json<{
        large: { providerId: string; model?: string };
        small?: { providerId: string; model?: string };
      }>();
      return c.json(await kernel.useLanes(body));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.delete("/api/providers/:id", async (c) => {
    await kernel.removeProvider(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.get("/api/memory", async (c) => {
    const query = c.req.query("q") ?? "";
    const limit = Number(c.req.query("limit") ?? "60") || 60;
    return c.json(await kernel.listMemory(query, Math.min(limit, 200)));
  });

  app.get("/api/memory/graph", async (c) => {
    const limit = Number(c.req.query("limit") ?? "80") || 80;
    return c.json(await kernel.experienceGraph(Math.min(limit, 200)));
  });

  app.get("/api/memory/:key", async (c) => {
    const note = await kernel.getMemory(decodeURIComponent(c.req.param("key")));
    if (!note) return c.json({ error: "not found" }, 404);
    return c.json(note);
  });

  app.put("/api/memory", async (c) => {
    try {
      const body = await c.req.json<{ key?: string; title: string; body: string; tags?: string[] }>();
      return c.json(await kernel.writeMemory(body));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.delete("/api/memory/:key", async (c) => {
    try {
      const ok = await kernel.removeMemory(decodeURIComponent(c.req.param("key")));
      if (!ok) return c.json({ error: "not found" }, 404);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get("/api/psyche", async (c) => {
    return c.json(await kernel.psycheState(c.req.query("runId") || undefined));
  });

  app.patch("/api/psyche", async (c) => {
    try {
      const body = await c.req.json<{
        compass?: string;
        character?: string[];
        light?: string[];
        shadow?: string[];
        constitution?: string;
      }>();
      return c.json(await kernel.updatePsyche(body));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  mountPluginRoutes(app, kernel, "/api/plugins");
  mountPluginRoutes(app, kernel, "/api/skills");

  app.get("/", (c) => {
    const html = staticFile("/");
    if (html) return html;
    return c.html(fallbackHtml());
  });

  return app;
}

function mountPluginRoutes(app: Hono, kernel: ReturnType<typeof getKernel>, prefix: "/api/plugins" | "/api/skills") {
  app.get(prefix, (c) => {
    return c.json(kernel.plugins.listPlugins().map((plugin) => ({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      ui: plugin.ui ?? null,
      mcp: plugin.mcp ?? null,
      source: plugin.source,
    })));
  });

  app.get(`${prefix}/:name`, (c) => {
    const plugin = kernel.plugins.getPlugin(c.req.param("name"));
    if (!plugin) return c.json({ error: "not found" }, 404);
    return c.json({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      ui: plugin.ui ?? null,
      mcp: plugin.mcp ?? null,
      source: plugin.source,
      prompt: plugin.prompt,
    });
  });

  app.get(`${prefix}/:name/ui`, (c) => {
    const plugin = kernel.plugins.getPlugin(c.req.param("name"));
    if (!plugin?.ui) return c.text("plugin has no ui", 404);
    try {
      return c.html(kernel.plugins.readAsset(plugin.name, plugin.ui));
    } catch (err) {
      return c.text(String(err), 404);
    }
  });

  app.get(`${prefix}/:name/raw`, (c) => {
    const plugin = kernel.plugins.getPlugin(c.req.param("name"));
    if (!plugin) return c.json({ error: "not found" }, 404);
    const rel = c.req.query("path") ?? "";
    try {
      return c.text(kernel.plugins.readAsset(plugin.name, rel));
    } catch (err) {
      return c.json({ error: String(err) }, 400);
    }
  });
}

function sessionView(sessions: AgentSessionApplication, snap: RunSnapshot) {
  return {
    ...snap,
    running: sessions.isRunning(snap.id),
    transcript: snap.transcript
      .map((item) => (
        item.kind === "assistant" ? { ...item, text: visibleAssistantText(item.text) } : item
      ))
      .filter((item) => item.kind !== "assistant" || item.text.trim()),
  };
}

function mountSessionRoutes(
  app: Hono,
  kernel: ReturnType<typeof getKernel>,
  sessions: AgentSessionApplication,
  prefix: "/api/sessions" | "/api/runs",
) {
  app.get(prefix, async (c) => {
    const runs = await sessions.list();
    return c.json(runs.map((run) => sessionView(sessions, run)));
  });

  app.get(`${prefix}/:id`, async (c) => {
    const run = await sessions.get(c.req.param("id"));
    if (!run) return c.json({ error: "not found" }, 404);
    return c.json(sessionView(sessions, run));
  });

  app.post(prefix, async (c) => {
    const body = await c.req.json<{ goal: string; agentId?: string }>();
    const run = await sessions.create({ goal: body.goal, agentId: body.agentId });
    return c.json(sessionView(sessions, run));
  });

  app.post(`${prefix}/:id/messages`, async (c) => {
    try {
      const body = await c.req.json<{ text: string }>();
      const run = await sessions.prompt(c.req.param("id"), body.text);
      return c.json(sessionView(sessions, run));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.post(`${prefix}/:id/resume`, async (c) => {
    try {
      const body = await c.req.json<{ mode?: "continue" | "retry" }>().catch(() => ({ mode: "continue" as const }));
      const run = await sessions.resume(c.req.param("id"), body.mode === "retry" ? "retry" : "continue");
      return c.json(sessionView(sessions, run));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.post(`${prefix}/:id/abort`, async (c) => {
    return c.json(sessions.cancel(c.req.param("id")));
  });

  app.post(`${prefix}/:id/close`, async (c) => {
    try {
      const run = await sessions.close(c.req.param("id"));
      return c.json(sessionView(sessions, run));
    } catch (err) {
      return c.json({ error: String(err) }, 400);
    }
  });

  app.post(`${prefix}/:id/form-agent`, async (c) => {
    const body = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
    const result = await kernel.formFromRun(c.req.param("id"), body.name);
    return c.json({ decision: result.decision, agent: result.agent.snapshot() });
  });

  app.post(`${prefix}/:id/permissions`, async (c) => {
    try {
      const body = await c.req.json<{ path?: string }>();
      const path = String(body.path ?? "").trim();
      if (!path) return c.json({ error: "path required" }, 400);
      const granted = await kernel.grantOutside(c.req.param("id"), path);
      const run = await sessions.get(c.req.param("id"));
      return c.json({ granted, grants: kernel.listOutsideGrants(c.req.param("id")), session: run ? sessionView(sessions, run) : null });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  app.get(`${prefix}/:id/permissions`, async (c) => {
    return c.json({ grants: kernel.listOutsideGrants(c.req.param("id")) });
  });

  app.get(`${prefix}/:id/files`, async (c) => {
    const run = await kernel.getRun(c.req.param("id"));
    if (!run) return c.json({ error: "not found" }, 404);
    const rel = c.req.query("path") ?? "";
    return c.json(kernel.listFiles(run.worktreePath, rel));
  });

  app.get(`${prefix}/:id/files/content`, async (c) => {
    const run = await kernel.getRun(c.req.param("id"));
    if (!run) return c.json({ error: "not found" }, 404);
    const rel = c.req.query("path") ?? "";
    const text = kernel.readFile(run.worktreePath, rel);
    run.append("console", `file ${rel}\n${text.slice(0, 4000)}`);
    await kernel.runs.save(run);
    return c.json({ path: rel, text });
  });

  app.get(`${prefix}/:id/files/bytes`, async (c) => {
    const run = await kernel.getRun(c.req.param("id"));
    if (!run) return c.json({ error: "not found" }, 404);
    const rel = c.req.query("path") ?? "";
    try {
      const file = kernel.readFileBytes(run.worktreePath, rel);
      return new Response(Buffer.from(file.bytes), { headers: { "content-type": file.type } });
    } catch (err) {
      return c.json({ error: String(err) }, 400);
    }
  });

  app.get(`${prefix}/:id/files/raw`, async (c) => {
    const run = await kernel.getRun(c.req.param("id"));
    if (!run) return c.json({ error: "not found" }, 404);
    const rel = c.req.query("path") ?? "";
    try {
      return c.json({ path: rel, text: kernel.readFile(run.worktreePath, rel) });
    } catch (err) {
      return c.json({ error: String(err) }, 400);
    }
  });

  app.get(`${prefix}/:id/processes`, async (c) => {
    return c.json(await kernel.processes.list(c.req.param("id")));
  });
}

export async function startWeb(opts: { port: number; host: string; open: boolean }): Promise<void> {
  const app = createApp();
  const kernel = getKernel();
  await kernel.boot();

  Bun.serve({
    port: opts.port,
    hostname: opts.host,
    idleTimeout: 0,
    fetch(req, server) {
      const path = new URL(req.url).pathname;
      if (path === "/api/ws") {
        if (server.upgrade(req)) return;
        return new Response("ws upgrade failed", { status: 400 });
      }
      if (req.method === "GET" && !path.startsWith("/api")) {
        const file = staticFile(path);
        if (file) return file;
      }
      return app.fetch(req);
    },
    websocket: {
      open(ws) {
        const client = { send: (data: string) => ws.send(data) };
        (ws as unknown as { client: typeof client }).client = client;
        clients.add(client);
      },
      close(ws) {
        const client = (ws as unknown as { client?: { send: (data: string) => void } }).client;
        if (client) clients.delete(client);
      },
      message() {},
    },
  });

  setInterval(() => {
    kernel.tick().catch((err) => console.error("psyche tick", err));
  }, 60_000);

  const url = `http://${opts.host}:${opts.port}`;
  console.log(`barney web at ${url}`);
  if (opts.open) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    Bun.spawn([opener, url], { stdout: "ignore", stderr: "ignore" });
  }
}

const MIME: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function staticFile(pathname: string): Response | null {
  const webDir = resolveWebDir();
  if (!webDir) return null;
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (rel.includes("..")) return null;
  const full = join(webDir, rel);
  if (!existsSync(full)) {
    if (!rel.includes(".")) return new Response(Bun.file(join(webDir, "index.html")), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    return null;
  }
  const ext = full.slice(full.lastIndexOf("."));
  return new Response(Bun.file(full), {
    headers: { "content-type": MIME[ext] ?? "application/octet-stream" },
  });
}

function resolveWebDir(): string | null {
  const extra = process.env.BARNEY_WEB_DIR?.trim();
  const candidates = [
    extra,
    join(import.meta.dir, "../../../apps/web/dist"),
    join(import.meta.dir, "apps/web/dist"),
    join(import.meta.dir, "dist"),
    join(import.meta.dir, "public"),
    join(process.cwd(), "apps/web/dist"),
    join(dirname(process.execPath), "web"),
  ].filter((dir): dir is string => Boolean(dir));
  return candidates.find((dir) => existsSync(join(dir, "index.html"))) ?? null;
}

function fallbackHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Barney</title>
  <style>
    :root { color-scheme: dark; --bg:#111; --panel:#1a1a1a; --line:#2a2a2a; --text:#e8e8e8; --muted:#9a9a9a; --accent:#6ea8fe; }
    * { box-sizing: border-box; }
    html, body { margin:0; height:100%; font: 13px/1.45 ui-sans-serif, system-ui; background:var(--bg); color:var(--text); }
    #app { display:grid; grid-template-columns: 220px 1fr; height:100%; }
    aside { border-right:1px solid var(--line); background:var(--panel); padding:12px; overflow:auto; }
    h1 { font-size:14px; margin:0 0 12px; }
    button, select, aside input { width:100%; margin:0 0 8px; background:#222; color:var(--text); border:1px solid var(--line); padding:7px 8px; text-align:left; }
    button.active { border-color:var(--accent); }
    .nav { color:var(--muted); font-size:11px; margin:14px 0 6px; text-transform:uppercase; }
    main { display:flex; flex-direction:column; height:100%; }
    #stream { flex:1; overflow:auto; padding:16px; }
    .item { margin:0 0 12px; }
    .kind { color:var(--muted); font-size:11px; text-transform:uppercase; }
    .thinking { color:#b9a6ff; }
    .console { font-family: ui-monospace, monospace; background:#0d0d0d; padding:8px; white-space:pre-wrap; }
    .review { color:#f0c36e; }
    .research { color:#7fd3c4; }
    form { display:flex; gap:8px; padding:12px; border-top:1px solid var(--line); }
    form input { flex:1; background:#222; color:var(--text); border:1px solid var(--line); padding:8px; }
    form button { width:auto; }
    #settings, #sessions { display:none; flex-direction:column; height:100%; }
    #settings.show, #sessions.show { display:flex; }
    #chat.show { display:flex; }
    #chat { display:flex; flex-direction:column; height:100%; }
    .sess { margin:0 0 8px; }
    .settings-head { display:flex; justify-content:space-between; align-items:center; padding:16px 20px; border-bottom:1px solid var(--line); }
    .settings-head h2 { margin:0; font-size:16px; }
    .settings-head button { width:auto; margin:0; }
    .settings-body { padding:20px; max-width:560px; }
    .settings-body label { display:block; color:var(--muted); font-size:11px; text-transform:uppercase; margin:12px 0 6px; }
    .settings-body input, .settings-body select { width:100%; margin:0 0 8px; background:#222; color:var(--text); border:1px solid var(--line); padding:8px; }
    .row-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
    .row-actions button { width:auto; margin:0; }
    .err { color:#f0a0a0; }
  </style>
</head>
<body>
  <div id="app">
    <aside>
      <h1>Barney</h1>
      <button id="newRun">New session</button>
      <div class="nav">Agents</div>
      <div id="agents"></div>
      <div class="nav">Sessions</div>
      <button id="openSessions">Choose a session</button>
      <div class="nav">Files</div>
      <div id="files"></div>
      <div class="nav">Processes</div>
      <div id="procs"></div>
      <div class="nav">Providers</div>
      <div id="providers"></div>
      <button id="provNew">+ Add provider</button>
      <button id="closeSess">Close session</button>
    </aside>
    <main>
      <div id="chat" class="show">
        <div id="stream"></div>
        <form id="composer"><input name="text" placeholder="Describe the goal and press Send" autocomplete="off" autofocus /><button>Send</button></form>
      </div>
      <div id="sessions">
        <div class="settings-head">
          <h2>Sessions</h2>
          <button id="sessBack">Back to chat</button>
        </div>
        <div class="settings-body" id="sessList"></div>
      </div>
      <div id="settings">
        <div class="settings-head">
          <h2 id="setTitle">Provider</h2>
          <button id="setBack">Back to chat</button>
        </div>
        <div class="settings-body">
          <label>Name</label>
          <input id="setName" />
          <label>Host (OpenAI-compatible)</label>
          <input id="setHost" placeholder="http://127.0.0.1:11434/v1" />
          <label>API key (optional)</label>
          <input id="setKey" type="password" placeholder="leave empty to keep" />
          <div id="setMeta" class="kind"></div>
          <div id="setErr" class="err"></div>
          <div class="row-actions">
            <button id="setSave">Save</button>
            <button id="setModels">Load models</button>
            <button id="setUse">Use model</button>
            <button id="setDel">Delete</button>
          </div>
          <label>Model</label>
          <select id="setModel"></select>
        </div>
      </div>
    </main>
  </div>
  <script>
    let runId = null, agentId = null, providerId = null, creating = false, providerCache = [];
    const stream = document.getElementById('stream');
    const $ = (id) => document.getElementById(id);
    async function j(url, opt) {
      const r = await fetch(url, opt);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || data.message || r.status);
      return data;
    }
    function showPane(name) {
      $('settings').classList.toggle('show', name === 'settings');
      $('sessions').classList.toggle('show', name === 'sessions');
      $('chat').classList.toggle('show', name === 'chat');
    }
    function showSettings(on) { showPane(on ? 'settings' : 'chat'); }
    function openProvider(id) {
      creating = !id;
      providerId = id || null;
      const p = providerCache.find(x => x.id === id);
      $('setTitle').textContent = creating ? 'New provider' : (p ? p.name : 'Provider');
      $('setName').value = p ? p.name : 'local';
      $('setHost').value = p ? p.baseUrl : 'http://127.0.0.1:11434/v1';
      $('setKey').value = '';
      $('setKey').placeholder = p && p.hasKey ? 'saved, leave empty to keep' : 'optional';
      $('setMeta').textContent = p ? (p.kind + ' · ' + p.baseUrl) : 'OpenAI-compatible. API key is optional.';
      $('setErr').textContent = '';
      $('setModel').innerHTML = p && p.defaultModel ? '<option>'+p.defaultModel+'</option>' : '';
      $('setHost').disabled = p && p.kind === 'stub';
      showSettings(true);
    }
    function item(kind, text) {
      const el = document.createElement('div');
      el.className = 'item ' + kind;
      el.innerHTML = '<div class="kind">'+kind+'</div><div>'+escapeHtml(text)+'</div>';
      stream.appendChild(el); stream.scrollTop = stream.scrollHeight;
    }
    function escapeHtml(s){ return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
    async function refresh() {
      const agents = await j('/api/agents');
      $('agents').innerHTML = agents.map(a => '<button data-agent="'+a.id+'">'+a.name+'</button>').join('');
      const runs = await j('/api/sessions');
      $('openSessions').textContent = runId ? (runs.find(r => r.id === runId)?.goal || 'Current session').slice(0, 40) : 'Choose a session';
      $('sessList').innerHTML = runs.length
        ? runs.map(r => '<button class="sess" data-run="'+r.id+'">'+escapeHtml(r.status)+' · '+escapeHtml(r.goal.slice(0,80))+'</button>').join('')
        : '<div class="kind">No sessions yet</div>';
      const p = await j('/api/providers');
      providerCache = p.providers || [];
      const active = (p.bindings || []).find(b => b.role === 'coder');
      $('providers').innerHTML = providerCache.map(x => {
        const mark = active && active.providerId === x.id ? '* ' : '';
        const on = providerId === x.id ? ' class="active"' : '';
        return '<button data-prov="'+x.id+'"'+on+'>'+mark+x.name+'</button>';
      }).join('');
      if (runId) {
        const run = await j('/api/sessions/'+runId);
        stream.innerHTML = '';
        run.transcript.forEach(t => item(t.kind, t.text));
        const files = await j('/api/sessions/'+runId+'/files');
        $('files').innerHTML = files.map(f => '<button data-file="'+f.path+'">'+f.name+'</button>').join('');
        const procs = await j('/api/sessions/'+runId+'/processes');
        $('procs').textContent = procs.length ? procs.map(p => p.command).join('\\n') : 'none';
      }
    }
    $('newRun').onclick = () => {
      runId = null;
      providerId = null;
      stream.innerHTML = '<div class="kind">New session. Write a goal below.</div>';
      $('files').innerHTML = '';
      $('procs').textContent = 'none';
      $('openSessions').textContent = 'Choose a session';
      showPane('chat');
      document.querySelector('#composer input')?.focus();
    };
    $('closeSess').onclick = async () => {
      if (!runId) return;
      await j('/api/sessions/'+runId+'/close', { method:'POST' });
      await refresh();
    };
    $('openSessions').onclick = () => { providerId = null; showPane('sessions'); refresh(); };
    $('sessBack').onclick = () => { showPane('chat'); refresh(); };
    $('sessList').onclick = async (e) => { const id = e.target.dataset.run; if (id) { runId = id; providerId = null; showPane('chat'); await refresh(); } };
    $('agents').onclick = (e) => { const id = e.target.dataset.agent; if (id) agentId = id; };
    $('providers').onclick = (e) => { const id = e.target.dataset.prov; if (id) openProvider(id); };
    $('provNew').onclick = () => openProvider(null);
    $('setBack').onclick = () => { providerId = null; showSettings(false); refresh(); };
    $('setSave').onclick = async () => {
      try {
        $('setErr').textContent = '';
        const body = { name: $('setName').value, host: $('setHost').value, apiKey: $('setKey').value || undefined };
        if (creating) {
          const created = await j('/api/providers', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
          providerId = created.id; creating = false;
        } else {
          await j('/api/providers/'+providerId, { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
        }
        await refresh();
        openProvider(providerId);
      } catch (err) { $('setErr').textContent = String(err); }
    };
    $('setModels').onclick = async () => {
      if (!providerId) { $('setErr').textContent = 'Save first'; return; }
      try {
        const r = await j('/api/providers/'+providerId+'/models');
        const opts = (r.models || []).map(m => '<option>'+m+'</option>').join('');
        $('setModel').innerHTML = opts;
      } catch (err) { $('setErr').textContent = String(err); }
    };
    $('setUse').onclick = async () => {
      if (!providerId) { $('setErr').textContent = 'Save first'; return; }
      try {
        await j('/api/lanes', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({
          large: { providerId, model: $('setModel').value || undefined },
        }) });
        await refresh();
      } catch (err) { $('setErr').textContent = String(err); }
    };
    $('setDel').onclick = async () => {
      if (!providerId) return;
      try {
        await j('/api/providers/'+providerId, { method:'DELETE' });
        providerId = null; showSettings(false); await refresh();
      } catch (err) { $('setErr').textContent = String(err); }
    };
    $('files').onclick = async (e) => {
      const path = e.target.dataset.file; if (!path || !runId) return;
      const file = await j('/api/sessions/'+runId+'/files/content?path='+encodeURIComponent(path));
      item('console', file.path + '\\n' + file.text);
    };
    $('composer').onsubmit = async (e) => {
      e.preventDefault();
      const text = e.target.text.value.trim(); if (!text) return;
      e.target.text.value = '';
      if (!runId) {
        const run = await j('/api/sessions', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ goal: text, agentId }) });
        runId = run.id;
      }
      item('user', text);
      await j('/api/sessions/'+runId+'/messages', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ text }) });
      await refresh();
    };
    const ws = new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host+'/api/ws');
    ws.onmessage = () => refresh();
    refresh();
  </script>
</body>
</html>`;
}
