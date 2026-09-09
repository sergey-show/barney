import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MarkdownBody } from "./MarkdownBody.tsx";
import { classifyClientError, interruptedNotice, type Alert } from "./alerts.ts";
import { api, jsonBody } from "./api.ts";
import { FilesPage } from "./FilesPage.tsx";
import { useLocale } from "./LocaleContext.tsx";
import { alertTitle, type Messages } from "./i18n.ts";
import { IconChat, IconMemory, IconPsyche, IconSessions, IconSettings } from "./icons.tsx";
import { MemoryPage } from "./MemoryPage.tsx";
import { PsychePage } from "./PsychePage.tsx";
import { SessionsPage } from "./SessionsPage.tsx";
import { groupTranscript, isOpenWork, isPrelude } from "./transcript.ts";
import { formatReplyFootnote } from "@domain/run/replyMeta.ts";
import { lanesOf, shortModel, type Agent, type FileEntry, type Item, type Lanes, type Plugin, type Provider, type ProviderState, type Run } from "./types.ts";

type Pane =
  | { kind: "chat" }
  | { kind: "sessions" }
  | { kind: "memory" }
  | { kind: "psyche" }
  | { kind: "settings" }
  | { kind: "provider"; id: string }
  | { kind: "new-provider" }
  | { kind: "plugin"; name: string; file?: string };

export function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [procs, setProcs] = useState<Array<{ id: string; command: string; status: string }>>([]);
  const [providerState, setProviderState] = useState<ProviderState>({ providers: [], bindings: [] });
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [pane, setPane] = useState<Pane>({ kind: "chat" });
  const [agentId, setAgentId] = useState<string>();
  const [runId, setRunId] = useState<string>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [debug, setDebug] = useState(() => localStorage.getItem("barney.debug") === "1");
  const [liveThink, setLiveThink] = useState("");
  const [browserModal, setBrowserModal] = useState<{ url: string; shot?: string } | null>(null);
  const [chatTab, setChatTab] = useState<"talk" | "files">("talk");
  const [filePath, setFilePath] = useState<string>();
  const [moreOpen, setMoreOpen] = useState(false);
  const { locale, t, setLocale } = useLocale();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const runIdRef = useRef<string | undefined>(runId);
  const pinBottomRef = useRef(true);
  const dismissedAlert = useRef("");
  runIdRef.current = runId;

  function stickBottom() {
    const el = streamRef.current;
    if (!el || !pinBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }

  function onStreamScroll() {
    const el = streamRef.current;
    if (!el) return;
    pinBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  const run = useMemo(() => runs.find((r) => r.id === runId), [runs, runId]);
  const lanes = useMemo(() => lanesOf(providerState), [providerState]);
  const activeCoder = providerState.bindings.find((b) => b.role === "coder");
  const transcriptEntries = useMemo(() => groupTranscript(run?.transcript ?? []), [run?.transcript]);
  const recentRuns = useMemo(
    () => [...runs].sort((a, b) => {
      const aAt = a.transcript.at(-1)?.at ?? "";
      const bAt = b.transcript.at(-1)?.at ?? "";
      return bAt.localeCompare(aAt);
    }).slice(0, 4),
    [runs],
  );
  const hasModel = Boolean(lanes.large);
  const runBusy = busy || Boolean(run?.running) || ["acting", "reviewing", "researching"].includes(run?.status ?? "");
  const runBlocked = ["done", "parked", "failed"].includes(run?.status ?? "");
  const canCompose = hasModel && !runBusy && !runBlocked;
  const starters = [
    { icon: "⌘", title: t.starterBuildTitle, hint: t.starterBuildHint, prompt: t.starterBuildPrompt },
    { icon: "◇", title: t.starterFixTitle, hint: t.starterFixHint, prompt: t.starterFixPrompt },
    { icon: "◎", title: t.starterExploreTitle, hint: t.starterExploreHint, prompt: t.starterExplorePrompt },
  ];

  useLayoutEffect(() => {
    stickBottom();
  }, [run?.transcript, pending, busy, alert, liveThink]);

  async function refresh(nextRunId = runId) {
    const [a, r, p, s] = await Promise.all([
      api<Agent[]>("/api/agents"),
      api<Run[]>("/api/sessions"),
      api<ProviderState>("/api/providers"),
      api<Plugin[]>("/api/plugins"),
    ]);
    setAgents(a);
    setRuns(r);
    setProviderState(p);
    setPlugins(s);
    if (!agentId && a[0]) setAgentId(a[0].id);
    if (nextRunId) {
      const nextFiles = await api<FileEntry[]>(`/api/sessions/${nextRunId}/files`);
      const processes = await api<Array<{ id: string; command: string; status: string }>>(`/api/sessions/${nextRunId}/processes`);
      setFiles(nextFiles);
      setProcs(processes);
      const session = r.find((item) => item.id === nextRunId);
      const notice = session ? interruptedNotice(session.transcript) : null;
      if (notice && dismissedAlert.current !== notice.detail) setAlert(notice);
    }
  }

  useEffect(() => {
    void refresh();
    let closed = false;
    let socket: WebSocket | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`);
      socket = ws;
      ws.onopen = () => {
        setAlert((prev) => (prev?.title === "Live updates paused" ? null : prev));
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as {
            event?: {
              type?: string;
              payload?: {
                runId?: string;
                delta?: string;
                name?: string;
                path?: string;
                prefix?: string;
                url?: string;
                shot?: string;
              };
            };
          };
          if (data.event?.type === "run.thinking_delta") {
            if (data.event.payload?.runId === runIdRef.current) {
              setLiveThink((prev) => prev + String(data.event?.payload?.delta ?? ""));
            }
            return;
          }
          if (data.event?.type === "run.thinking") {
            void refresh(runIdRef.current).finally(() => setLiveThink(""));
            return;
          }
          if (data.event?.type === "run.permission_needed") {
            const payload = data.event.payload;
            if (!payload || payload.runId !== runIdRef.current) return;
            const prefix = String(payload.prefix || payload.path || "").trim();
            if (!prefix) return;
            setAlert({
              level: "warning",
              title: "Permission needed",
              detail: `Allow outside access for ${prefix}?`,
              allowPrefix: prefix,
            });
            void refresh(runIdRef.current);
            return;
          }
          if (data.event?.type === "run.permission_granted") {
            if (data.event.payload?.runId === runIdRef.current) {
              setAlert((prev) => (prev?.allowPrefix ? null : prev));
              void refresh(runIdRef.current);
            }
            return;
          }
          if (data.event?.type === "browser.shown") {
            const payload = data.event.payload;
            if (!payload || payload.runId !== runIdRef.current || !payload.url) return;
            setBrowserModal({ url: payload.url, shot: payload.shot || undefined });
            return;
          }
          if (data.event?.type === "plugin.opened" || data.event?.type === "skill.opened") {
            const payload = data.event.payload;
            if (!payload || payload.runId !== runIdRef.current) return;
            const file = String(payload.path ?? "");
            if (file) {
              setFilePath(file);
              setPane({ kind: "chat" });
              setChatTab("files");
              void refresh(runIdRef.current);
              return;
            }
            const name = String(payload.name ?? "");
            if (name) setPane({ kind: "plugin", name });
            void refresh(runIdRef.current);
            return;
          }
        } catch {
          /* refresh below */
        }
        void refresh(runIdRef.current);
      };
      ws.onclose = () => {
        if (closed) return;
        retry = setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, []);

  function beginSession() {
    setRunId(undefined);
    setFiles([]);
    setProcs([]);
    setPane({ kind: "chat" });
    setChatTab("talk");
    setDraft("");
    setAlert(null);
    setPending(null);
    setLiveThink("");
    setMoreOpen(false);
    queueMicrotask(() => composerRef.current?.focus());
  }

  async function startRun(goal: string) {
    setBusy(true);
    setAlert(null);
    setPending(goal);
    setLiveThink("");
    setPane({ kind: "chat" });
    try {
      const created = await api<Run>("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal, agentId }),
      });
      runIdRef.current = created.id;
      setRunId(created.id);
      const updated = await api<Run>(`/api/sessions/${created.id}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: goal }),
      });
      setRuns((prev) => [...prev.filter((item) => item.id !== updated.id), updated]);
      await refresh(created.id);
      setPending(null);
    } catch (err) {
      setAlert(classifyClientError(err));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || !canCompose) return;
    setDraft("");
    setAlert(null);
    pinBottomRef.current = true;
    setPending(text);
    setLiveThink("");
    if (!runId) {
      await startRun(text);
      return;
    }
    setBusy(true);
    try {
      const updated = await api<Run>(`/api/sessions/${runId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      setRuns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      await refresh(runId);
      setPending(null);
    } catch (err) {
      setAlert(classifyClientError(err));
      setPending(null);
      await refresh(runId).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function resume(mode: "continue" | "retry") {
    if (!runId || run?.status === "done") return;
    setAlert(null);
    setBusy(true);
    setLiveThink("");
    setPending(mode === "retry" ? "Retry last request" : "Continue interrupted work");
    try {
      const updated = await api<Run>(`/api/sessions/${runId}/resume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      setRuns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      await refresh(runId);
      setPending(null);
    } catch (err) {
      setAlert(classifyClientError(err));
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  async function allowOutside(prefix: string) {
    if (!runId || !prefix.trim()) return;
    setBusy(true);
    try {
      await api<{ granted: string }>(`/api/sessions/${runId}/permissions`, {
        method: "POST",
        ...jsonBody({ path: prefix }),
      });
      setAlert(null);
      await refresh(runId);
      await resume("continue");
    } catch (err) {
      setAlert(classifyClientError(err));
      setBusy(false);
    }
  }

  function openFile(path: string) {
    setFilePath(path);
    setPane({ kind: "chat" });
    setChatTab("files");
  }

  async function formAgent() {
    if (!runId) return;
    await api(`/api/sessions/${runId}/form-agent`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await refresh(runId);
  }

  async function abortStep() {
    if (!runId) return;
    await api(`/api/sessions/${runId}/abort`, { method: "POST" }).catch(() => undefined);
    await refresh(runId);
  }

  async function closeSession(id = runId) {
    if (!id) return;
    const current = runs.find((item) => item.id === id);
    if (current?.status === "done") return;
    const updated = await api<Run>(`/api/sessions/${id}/close`, { method: "POST" });
    setRuns((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  }

  function openSession(id: string) {
    setLiveThink("");
    setRunId(id);
    setPane({ kind: "chat" });
    setChatTab("talk");
    void refresh(id);
  }

  function useStarter(text: string) {
    setDraft(text);
    queueMicrotask(() => composerRef.current?.focus());
  }

  return (
    <div className="shell">
      <aside className="side">
        <button type="button" className="brand" onClick={beginSession} aria-label="Barney">
          <img className="brand-logo" src="/logo-barney.svg" alt="Barney" />
          <span className="brand-beta">Agent</span>
        </button>
        <button className="primary new-task" onClick={beginSession}><span aria-hidden="true">＋</span>{t.newTask}</button>
        <nav className="nav-main" aria-label={t.navAria}>
          <NavBtn active={pane.kind === "chat"} onClick={() => { setPane({ kind: "chat" }); setChatTab("talk"); }} icon={<IconChat />} label={t.navChat} hint={run ? run.goal : t.navChatHint} />
          <NavBtn active={pane.kind === "sessions"} onClick={() => setPane({ kind: "sessions" })} icon={<IconSessions />} label={t.navHistory} hint={t.navHistoryHint(runs.filter((item) => item.status !== "done").length)} />
          <NavBtn active={pane.kind === "memory"} onClick={() => setPane({ kind: "memory" })} icon={<IconMemory />} label={t.navNotes} hint={t.navNotesHint} />
          <NavBtn active={pane.kind === "psyche"} onClick={() => setPane({ kind: "psyche" })} icon={<IconPsyche />} label={t.navCharacter} hint={t.navCharacterHint} />
          <NavBtn active={pane.kind === "settings" || pane.kind === "provider" || pane.kind === "new-provider"} onClick={() => setPane({ kind: "settings" })} icon={<IconSettings />} label={t.navSettings} hint={t.navSettingsHint} />
        </nav>
        {recentRuns.length ? (
          <div className="recent-block">
            <div className="nav-section-label">{t.recentTasks}</div>
            {recentRuns.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`recent-run ${item.id === runId && pane.kind === "chat" ? "active" : ""}`}
                onClick={() => openSession(item.id)}
              >
                <span className={`status-dot ${item.running ? "running" : item.status}`} />
                <span>{item.goal || t.untitled}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="side-footer">
          <button type="button" className="model-status" onClick={() => setPane({ kind: "settings" })}>
            <span className={`status-dot ${hasModel ? "ready" : "warning"}`} />
            <span>
              <strong>{hasModel ? shortModel(lanes.large!.model) : t.modelNotReady}</strong>
              <small>{hasModel ? t.modelReady : t.configureModel}</small>
            </span>
          </button>
          <div className="lang-compact" role="group" aria-label={t.language}>
            <button type="button" className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>EN</button>
            <button type="button" className={locale === "ru" ? "active" : ""} onClick={() => setLocale("ru")}>RU</button>
          </div>
        </div>
      </aside>
      {pane.kind === "chat" ? (
        <section className="chat">
          <header className="chat-head">
            <div className="task-heading">
              <div className="task-title">{run?.goal || t.newTask}</div>
              <div className="task-meta">
                {run ? <span className={`run-status ${run.running ? "running" : run.status}`}><span className="status-dot" />{run.running ? t.running : statusLabel(run.status, t)}</span> : null}
                {run?.attempts ? <span>{t.attempts(run.attempts)}</span> : null}
                {runId ? <span className="mono task-id">{runId.slice(0, 8)}</span> : null}
              </div>
            </div>
            <div className="head-actions">
              <div className="view-switch" role="tablist" aria-label={t.taskView}>
                <button type="button" className={chatTab === "talk" ? "active" : ""} onClick={() => setChatTab("talk")}>{t.talkTab}</button>
                <button type="button" className={chatTab === "files" ? "active" : ""} onClick={() => setChatTab("files")}>
                  {t.filesTab}{files.length ? ` ${files.length}` : ""}
                </button>
              </div>
              <div className="more-pop">
                <button type="button" className="icon-button" aria-label={t.more} aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>•••</button>
                {moreOpen ? (
                  <div className="more-menu">
                    <button type="button" className="menu-item" onClick={() => { setMoreOpen(false); beginSession(); }}>{t.newTask}</button>
                    <button type="button" className="menu-item" disabled={!runId || run?.status === "done"} onClick={() => { setMoreOpen(false); void closeSession(); }}>{t.closeChat}</button>
                    <button type="button" className="item" disabled={!runId} onClick={() => { setMoreOpen(false); void formAgent(); }}>{t.formAgent}</button>
                    {plugins.map((plugin) => (
                      <button
                        key={plugin.name}
                        type="button"
                        className="item"
                        onClick={() => { setMoreOpen(false); setPane({ kind: "plugin", name: plugin.name }); }}
                      >
                        {plugin.name}
                      </button>
                    ))}
                    {procs.length ? <div className="muted procs">{procs.map((p) => `${p.status} ${p.command}`).join("\n")}</div> : null}
                  </div>
                ) : null}
              </div>
            </div>
          </header>
          {chatTab === "files" ? (
            <FilesPage sessionId={runId} initialPath={filePath} />
          ) : (
          <>
          <div className="stream" ref={streamRef} onScroll={onStreamScroll}>
            {!run && !pending ? (
              <div className="empty-hero">
                <div className="hero-mark" aria-hidden="true">B</div>
                <h1>{t.emptyTitle}</h1>
                <p>{t.emptyChat}</p>
                {!hasModel ? (
                  <button type="button" className="setup-callout" onClick={() => setPane({ kind: "settings" })}>
                    <span className="status-dot warning" />
                    <span><strong>{t.setupModelTitle}</strong><small>{t.pickModels}</small></span>
                    <span aria-hidden="true">→</span>
                  </button>
                ) : (
                  <div className="starter-grid">
                    {starters.map((starter) => (
                      <button type="button" key={starter.title} className="starter-card" onClick={() => useStarter(starter.prompt)}>
                        <span className="starter-icon">{starter.icon}</span>
                        <span><strong>{starter.title}</strong><small>{starter.hint}</small></span>
                        <span className="starter-arrow" aria-hidden="true">↗</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {transcriptEntries.map((entry, index) => {
                  if (entry.type === "work") {
                    if (!debug && isPrelude(entry, index, transcriptEntries)) return null;
                    const live = busy && isOpenWork(index, transcriptEntries);
                    return (
                      <WorkFold
                        key={entry.items[0]?.id ?? `work-${index}`}
                        items={entry.items}
                        live={live}
                        liveThink={live ? liveThink : ""}
                      />
                    );
                  }
                  return <TranscriptRow key={entry.item.id} item={entry.item} />;
                })}
                {pending && !run?.transcript.some((item) => item.kind === "user" && item.text === pending) ? (
                  <div className="row user">
                    <div className="kind">{t.user}</div>
                    <div className="body">{pending}</div>
                  </div>
                ) : null}
                {busy && !transcriptEntries.some((entry, index) => entry.type === "work" && isOpenWork(index, transcriptEntries)) ? (
                  <WorkFold items={[]} live liveThink={liveThink} />
                ) : null}
              </>
            )}
          </div>
          {alert ? (
            <AlertBanner
              alert={alert}
              busy={busy}
              canResume={Boolean(runId) && run?.status !== "done"}
              onContinue={() => void resume("continue")}
              onRetry={() => void resume("retry")}
              onAllow={alert.allowPrefix && runId ? () => void allowOutside(alert.allowPrefix!) : undefined}
              onDismiss={() => {
                dismissedAlert.current = alert.detail;
                setAlert(null);
              }}
            />
          ) : null}
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              onFocus={() => {
                pinBottomRef.current = true;
                requestAnimationFrame(stickBottom);
              }}
              placeholder={runBusy
                ? t.composerBusy
                : run?.status === "parked" || run?.status === "failed"
                ? t.composerBlocked
                : runBlocked
                ? t.composerClosed
                : run
                ? t.composerFollow
                : t.composerEmpty}
              disabled={!canCompose}
              rows={1}
            />
            <div className="composer-meta">
              <span>{run ? t.composerContext(files.length) : hasModel ? t.composerReady(shortModel(lanes.large!.model)) : t.configureModel}</span>
              <span>{t.sendHint}</span>
            </div>
            {runBusy ? (
              <button type="button" className="composer-action stop" disabled={!runId} onClick={() => void abortStep()} aria-label={t.stop}>■</button>
            ) : (
              <button className="composer-action send" disabled={!draft.trim() || !canCompose} aria-label={t.send}>↑</button>
            )}
          </form>
          </>
          )}
        </section>
      ) : pane.kind === "plugin" ? (
        <PluginView
          plugin={pane.name}
          file={pane.file}
          sessionId={runId}
          onClose={() => setPane({ kind: "chat" })}
        />
      ) : pane.kind === "sessions" ? (
        <SessionsPage
          sessions={runs}
          currentId={runId}
          onNew={beginSession}
          onOpen={openSession}
          onCloseSession={(id) => void closeSession(id)}
        />
      ) : pane.kind === "memory" ? (
        <MemoryPage />
      ) : pane.kind === "psyche" ? (
        <PsychePage runId={runId} />
      ) : pane.kind === "settings" || pane.kind === "provider" || pane.kind === "new-provider" ? (
        <>
          <ModelsEditor
            providers={providerState.providers}
            lanes={lanes}
            plugins={plugins}
            debug={debug}
            onDebug={(value) => {
              setDebug(value);
              localStorage.setItem("barney.debug", value ? "1" : "0");
            }}
            onOpenProvider={(id) => setPane(id ? { kind: "provider", id } : { kind: "new-provider" })}
            onChanged={async () => { await refresh(runId); }}
          />
          {pane.kind === "provider" || pane.kind === "new-provider" ? (
            <ProviderEditor
              pane={pane}
              providers={providerState.providers}
              lanes={lanes}
              activeModel={activeCoder?.model}
              onClose={() => setPane({ kind: "settings" })}
              onChanged={async (nextId) => {
                await refresh(runId);
                if (nextId) setPane({ kind: "provider", id: nextId });
                else setPane({ kind: "settings" });
              }}
            />
          ) : null}
        </>
      ) : (
        <section className="page" />
      )}
      {browserModal ? (
        <BrowserModal
          url={browserModal.url}
          shot={browserModal.shot}
          sessionId={runId}
          onClose={() => setBrowserModal(null)}
        />
      ) : null}
    </div>
  );
}

function statusLabel(status: string, t: Messages): string {
  if (status === "done") return t.statusDone;
  if (status === "failed") return t.statusFailed;
  if (status === "parked") return t.statusPaused;
  if (status === "reviewing") return t.statusReviewing;
  if (status === "researching") return t.statusResearching;
  if (status === "acting") return t.statusWorking;
  return t.statusReady;
}

type ProcessEntry = { type: "stream"; kind: "thinking" | "console"; items: Item[] } | { type: "row"; item: Item };

function groupProcess(items: Item[]): ProcessEntry[] {
  const grouped: ProcessEntry[] = [];
  for (const item of items) {
    const last = grouped.at(-1);
    if ((item.kind === "thinking" || item.kind === "console") && last?.type === "stream" && last.kind === item.kind) {
      last.items.push(item);
    } else if (item.kind === "thinking" || item.kind === "console") {
      grouped.push({ type: "stream", kind: item.kind, items: [item] });
    } else {
      grouped.push({ type: "row", item });
    }
  }
  return grouped;
}

function workSummary(items: Item[], live: boolean, labels: { progress: string; thinking: (n: number) => string; console: (n: number) => string; other: (n: number) => string; hidden: string }): string {
  if (live) return labels.progress;
  const thinks = items.filter((item) => item.kind === "thinking").length;
  const consoles = items.filter((item) => item.kind === "console").length;
  const extras = items.filter((item) => item.kind !== "thinking" && item.kind !== "console").length;
  const parts = [
    thinks ? labels.thinking(thinks) : "",
    consoles ? labels.console(consoles) : "",
    extras ? labels.other(extras) : "",
  ].filter(Boolean);
  return parts.join(" · ") || labels.hidden;
}

function NavBtn(props: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button type="button" className={`nav-btn ${props.active ? "active" : ""}`} onClick={props.onClick}>
      <span className="nav-icon">{props.icon}</span>
      <span className="nav-copy">
        <span className="nav-label-text">{props.label}</span>
        <span className="nav-hint">{props.hint}</span>
      </span>
    </button>
  );
}

function AlertBanner(props: {
  alert: Alert;
  busy: boolean;
  canResume: boolean;
  onContinue: () => void;
  onRetry: () => void;
  onAllow?: () => void;
  onDismiss: () => void;
}) {
  const { locale, t } = useLocale();
  return (
    <div className={`alert ${props.alert.level}`}>
      <div className="alert-title">{alertTitle(locale, props.alert.title)}</div>
      <div className="muted">{props.alert.detail}</div>
      <div className="alert-actions">
        {props.onAllow ? (
          <button type="button" className="primary" disabled={props.busy} onClick={props.onAllow}>{t.allowPath}</button>
        ) : null}
        {props.canResume && !props.onAllow ? (
          <>
            <button type="button" className="primary" disabled={props.busy} onClick={props.onContinue}>{t.continue}</button>
            <button type="button" className="item" disabled={props.busy} onClick={props.onRetry}>{t.retry}</button>
          </>
        ) : null}
        {props.canResume && props.onAllow ? (
          <button type="button" className="item" disabled={props.busy} onClick={props.onContinue}>{t.continue}</button>
        ) : null}
        <button type="button" className="item" disabled={props.busy} onClick={props.onDismiss}>{t.dismiss}</button>
      </div>
    </div>
  );
}

function TranscriptRow(props: { item: Item }) {
  const { t } = useLocale();
  const { item } = props;
  if (item.kind === "review" || item.kind === "system") {
    return <FoldRow kind={item.kind} text={item.text} />;
  }
  const footnote = item.kind === "assistant" ? formatReplyFootnote(item.meta) : "";
  return (
    <div className={`row ${item.kind}`}>
      <div className="kind">{item.kind === "user" ? t.user : item.kind}</div>
      {item.kind === "assistant" ? <MarkdownBody text={item.text} /> : <div className="body">{item.text}</div>}
      {footnote ? <div className="reply-footnote">{footnote}</div> : null}
    </div>
  );
}

function FoldRow(props: { kind: string; text: string }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const preview = props.text.replace(/\s+/g, " ").slice(0, 80);
  return (
    <div className={`row ${props.kind} fold`}>
      <button type="button" className="fold-head" onClick={() => setOpen((value) => !value)}>
        <span className="kind">{props.kind}</span>
        <span className="fold-preview">{open ? t.hide : preview}</span>
      </button>
      {open ? <div className="body">{props.text}</div> : null}
    </div>
  );
}

function WorkFold(props: { items: Item[]; live: boolean; liveThink: string }) {
  const { t } = useLocale();
  const userToggled = useRef(false);
  const [open, setOpen] = useState(props.live);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inner = groupProcess(props.items);
  const lastThinking = [...props.items].reverse().find((item) => item.kind === "thinking");
  const lastConsole = [...props.items].reverse().find((item) => item.kind === "console");

  useEffect(() => {
    if (userToggled.current) return;
    setOpen(props.live);
  }, [props.live]);

  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [open, props.items, props.liveThink, props.live]);

  return (
    <div className={`work-fold ${props.live ? "live" : ""}`}>
      <button
        type="button"
        className="work-fold-head"
        onClick={() => {
          userToggled.current = true;
          setOpen((value) => !value);
        }}
      >
        <span className="kind">{t.kindWork}</span>
        <span className="fold-preview">{workSummary(props.items, props.live, {
          progress: t.workInProgress,
          thinking: t.workThinking,
          console: t.workConsole,
          other: t.workOther,
          hidden: t.workHidden,
        })}</span>
        <span className="thinking-toggle">{open ? "▾" : "▸"}</span>
      </button>
      {props.live ? (
        <div className="thinking-bar-track">
          <div className="thinking-bar-fill" />
        </div>
      ) : null}
      {open ? (
        <div className="work-fold-body" ref={bodyRef}>
          {props.live ? (
            <>
              <div className="work-live-think">
                {props.liveThink || lastThinking?.text || t.working}
                <span className="thinking-dots" aria-hidden="true" />
              </div>
              {inner
                .filter((entry) => entry.type === "stream" && entry.kind === "console")
                .map((entry) =>
                  entry.type === "stream" ? (
                    <StreamFold
                      key={entry.items[0].id}
                      kind="console"
                      texts={entry.items.map((item) => item.text)}
                      live={entry.items.some((item) => item.id === lastConsole?.id)}
                    />
                  ) : null,
                )}
            </>
          ) : (
            inner.map((entry) =>
              entry.type === "stream" ? (
                <StreamFold
                  key={entry.items[0].id}
                  kind={entry.kind}
                  texts={entry.items.map((item) => item.text)}
                  live={false}
                />
              ) : (
                <TranscriptRow key={entry.item.id} item={entry.item} />
              ),
            )
          )}
        </div>
      ) : null}
    </div>
  );
}

function StreamFold(props: { kind: "thinking" | "console"; texts: string[]; live: boolean }) {
  const { t } = useLocale();
  const userToggled = useRef(false);
  const [open, setOpen] = useState(props.kind === "thinking" && props.live);
  const bodyRef = useRef<HTMLDivElement>(null);
  const preview = (props.texts.at(-1) ?? props.kind).replace(/\s+/g, " ").slice(0, 72);

  useEffect(() => {
    if (userToggled.current || props.kind === "console") return;
    setOpen(props.live);
  }, [props.live, props.kind]);

  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [open, props.texts, props.live]);

  return (
    <div className={`stream-fold ${props.kind} ${props.live ? "live" : ""}`}>
      <button
        type="button"
        className="stream-fold-head"
        onClick={() => {
          userToggled.current = true;
          setOpen((value) => !value);
        }}
      >
        <span className="kind">{props.kind === "thinking" ? t.kindThinking : t.kindConsole}</span>
        <span className="fold-preview">{props.live && !open ? t.workInProgress : preview}</span>
        <span className="thinking-toggle">{open ? "▾" : "▸"}</span>
      </button>
      {props.live ? (
        <div className="thinking-bar-track">
          <div className="thinking-bar-fill" />
        </div>
      ) : null}
      {open ? (
        <div className="stream-fold-body" ref={bodyRef}>
          {props.texts.map((text, index) => (
            <p key={`${index}-${text.slice(0, 24)}`}>{text}</p>
          ))}
          {props.live ? <span className="thinking-dots" aria-hidden="true" /> : null}
        </div>
      ) : null}
    </div>
  );
}

function BrowserModal(props: { url: string; shot?: string; sessionId?: string; onClose: () => void }) {
  const [embed, setEmbed] = useState(false);
  const shotSrc = props.shot && props.sessionId
    ? `/api/sessions/${props.sessionId}/files/bytes?path=${encodeURIComponent(props.shot)}`
    : "";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onClose]);

  const { t } = useLocale();
  return (
    <div className="modal-root" role="dialog" aria-modal="true" aria-label={t.shownForYou}>
      <button type="button" className="modal-backdrop" aria-label={t.close} onClick={props.onClose} />
      <div className="modal-card">
        <header className="skill-view-bar">
          <button type="button" className="item" onClick={props.onClose}>{t.close}</button>
          <div>
            <div className="kind">{t.shownForYou}</div>
            <div><a href={props.url} target="_blank" rel="noreferrer">{props.url}</a></div>
          </div>
          <button type="button" className="item" onClick={() => setEmbed((value) => !value)}>
            {embed ? t.hideEmbed : t.tryEmbed}
          </button>
        </header>
        {shotSrc ? (
          <img className="browser-shot" src={shotSrc} alt={props.url} />
        ) : (
          <div className="muted" style={{ padding: 16 }}>
            {t.shotComing}
          </div>
        )}
        {embed ? (
          <iframe className="skill-frame" title="browser" src={props.url} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        ) : null}
      </div>
    </div>
  );
}

function PluginView(props: { plugin: string; file?: string; sessionId?: string; onClose: () => void }) {
  const { t } = useLocale();
  const src = new URL(`/api/plugins/${encodeURIComponent(props.plugin)}/ui`, location.origin);
  if (props.sessionId) src.searchParams.set("session", props.sessionId);
  if (props.file) src.searchParams.set("file", props.file);
  return (
    <section className="skill-view">
      <header className="skill-view-bar">
        <button type="button" className="item" onClick={props.onClose}>{t.back}</button>
        <div>
          <div className="kind">plugin</div>
          <div>{props.plugin}{props.file ? ` · ${props.file}` : ""}</div>
        </div>
      </header>
      {props.file && !props.sessionId ? (
        <div className="muted">{t.pluginNeedSession}</div>
      ) : (
        <iframe className="skill-frame" title={props.plugin} src={src.toString()} sandbox="allow-scripts allow-same-origin" />
      )}
    </section>
  );
}

function ModelsEditor(props: {
  providers: Provider[];
  lanes: Lanes;
  plugins: Plugin[];
  debug: boolean;
  onDebug: (value: boolean) => void;
  onOpenProvider: (id?: string) => void;
  onChanged: () => Promise<void>;
}) {
  const live = props.providers.filter((item) => item.kind !== "stub");
  const fallback = live[0] ?? props.providers[0];
  const [largeProvider, setLargeProvider] = useState(props.lanes.large?.providerId ?? fallback?.id ?? "");
  const [largeModel, setLargeModel] = useState(props.lanes.large?.model ?? "");
  const [catalog, setCatalog] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { locale, t, setLocale } = useLocale();

  useEffect(() => {
    setLargeProvider(props.lanes.large?.providerId ?? fallback?.id ?? "");
    setLargeModel(props.lanes.large?.model ?? "");
  }, [props.lanes.large?.providerId, props.lanes.large?.model, fallback?.id]);

  async function load(providerId: string) {
    if (!providerId) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ models: string[] }>(`/api/providers/${providerId}/models`);
      setCatalog((prev) => ({ ...prev, [providerId]: result.models }));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!largeProvider || !largeModel.trim()) {
      setError(t.pickLarge);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/lanes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          large: { providerId: largeProvider, model: largeModel.trim() },
        }),
      });
      await props.onChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h2>{t.settingsTitle}</h2>
          <p className="lede">{t.settingsLede}</p>
        </div>
      </header>
      <div className="page-body settings-page">
        <section className="settings-section model-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{t.runtime}</span>
              <h3>{t.activeModel}</h3>
              <p>{t.activeModelHint}</p>
            </div>
            <span className={`connection-badge ${props.lanes.large ? "connected" : ""}`}>
              <span className="status-dot" />
              {props.lanes.large ? t.connected : t.notConfigured}
            </span>
          </div>
          <LaneFields
            title={t.largeModel}
            providers={props.providers}
            providerId={largeProvider}
            model={largeModel}
            models={catalog[largeProvider] ?? []}
            onProvider={(id) => setLargeProvider(id)}
            onModel={setLargeModel}
            onLoad={() => void load(largeProvider)}
            busy={busy}
          />
          {error ? <div className="error" role="alert">{error}</div> : null}
          <div className="section-actions">
            <button className="primary compact" disabled={busy || !largeProvider} onClick={() => void apply()}>{t.applyLanes}</button>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{t.infrastructure}</span>
              <h3>{t.providers}</h3>
              <p>{t.providersHint}</p>
            </div>
            <button type="button" className="secondary-button" onClick={() => props.onOpenProvider()}>＋ {t.addProvider}</button>
          </div>
          {props.providers.length === 0 ? (
            <div className="section-empty">{t.noProviders}</div>
          ) : (
            <div className="integration-grid">
              {props.providers.map((item) => {
                const active = props.lanes.large?.providerId === item.id;
                return (
                  <button key={item.id} type="button" className="integration-card" onClick={() => props.onOpenProvider(item.id)}>
                    <span className="integration-mark">{item.name.slice(0, 1).toUpperCase()}</span>
                    <span className="integration-copy">
                      <span className="integration-title">
                        {item.name}
                        {active ? <span className="mini-badge">{t.active}</span> : null}
                      </span>
                      <span className="integration-meta">{item.dialect || item.kind}</span>
                      <span className="integration-url mono">{item.baseUrl}</span>
                    </span>
                    <span className="integration-arrow">→</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="settings-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{t.capabilities}</span>
              <h3>{t.plugins}</h3>
              <p>{t.pluginsHint}</p>
            </div>
            <span className="count-badge">{props.plugins.length}</span>
          </div>
          {props.plugins.length === 0 ? <div className="section-empty">{t.noPlugins}</div> : (
            <div className="plugin-grid">
              {props.plugins.map((plugin) => (
                <div key={plugin.name} className="plugin-card">
                  <span className="plugin-mark">⌁</span>
                  <span className="integration-copy">
                    <span className="integration-title">{plugin.name}</span>
                    <span className="integration-meta">{plugin.description || t.pluginNoDescription}</span>
                  </span>
                  <span className="mini-badge">{plugin.ui ? "UI" : plugin.mcp ? "MCP" : t.installed}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="settings-section preferences-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{t.preferences}</span>
              <h3>{t.interfaceTitle}</h3>
            </div>
          </div>
          <div className="preference-row">
            <div><strong>{t.language}</strong><span>{t.languageHint}</span></div>
            <div className="segmented" id="ui-lang">
              <button type="button" className={locale === "en" ? "active" : ""} onClick={() => setLocale("en")}>EN</button>
              <button type="button" className={locale === "ru" ? "active" : ""} onClick={() => setLocale("ru")}>RU</button>
            </div>
          </div>
          <label className="preference-row toggle-row">
            <div><strong>{t.showDebug}</strong><span>{t.showDebugHint}</span></div>
            <input type="checkbox" checked={props.debug} onChange={(e) => props.onDebug(e.target.checked)} />
          </label>
        </section>
      </div>
    </section>
  );
}

function LaneFields(props: {
  title: string;
  providers: Provider[];
  providerId: string;
  model: string;
  models: string[];
  onProvider: (id: string) => void;
  onModel: (model: string) => void;
  onLoad: () => void;
  busy: boolean;
}) {
  const { t } = useLocale();
  const options = props.model && !props.models.includes(props.model) ? [props.model, ...props.models] : props.models;
  return (
    <div className="model-picker">
      <div className="field-group">
        <label>{t.provider}</label>
        <select value={props.providerId} onChange={(e) => props.onProvider(e.target.value)}>
          {props.providers.length === 0 ? <option value="">{t.noProviders}</option> : null}
          {props.providers.map((item) => (
            <option key={item.id} value={item.id}>{item.name} · {item.kind}</option>
          ))}
        </select>
      </div>
      <div className="field-group model-field">
        <label>{props.title}</label>
        {options.length > 0 ? (
          <select value={props.model} onChange={(e) => props.onModel(e.target.value)}>
            {options.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        ) : (
          <input value={props.model} onChange={(e) => props.onModel(e.target.value)} placeholder={t.modelPlaceholder} />
        )}
      </div>
      <div className="field-action">
        <button className="secondary-button" type="button" disabled={props.busy || !props.providerId} onClick={props.onLoad}>{t.loadModels}</button>
      </div>
    </div>
  );
}

function ProviderEditor(props: {
  pane: { kind: "provider"; id: string } | { kind: "new-provider" };
  providers: Provider[];
  lanes: Lanes;
  activeModel?: string;
  onClose: () => void;
  onChanged: (id?: string) => Promise<void>;
}) {
  const paneId = props.pane.kind === "provider" ? props.pane.id : undefined;
  const existing = paneId ? props.providers.find((p) => p.id === paneId) : undefined;
  const [name, setName] = useState(existing?.name ?? "local");
  const [host, setHost] = useState(existing?.baseUrl ?? "http://127.0.0.1:11434/v1");
  const [dialect, setDialect] = useState(existing?.dialect ?? "");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [largeModel, setLargeModel] = useState(
    existing && props.lanes.large?.providerId === existing.id ? props.lanes.large.model : existing?.defaultModel ?? props.activeModel ?? "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { t } = useLocale();

  useEffect(() => {
    setName(existing?.name ?? "local");
    setHost(existing?.baseUrl ?? "http://127.0.0.1:11434/v1");
    setDialect(existing?.dialect ?? "");
    setApiKey("");
    setModels([]);
    setLargeModel(existing && props.lanes.large?.providerId === existing.id ? props.lanes.large.model : existing?.defaultModel ?? "");
    setError("");
    setConfirmRemove(false);
  }, [existing?.id, props.pane.kind, props.lanes.large?.providerId, props.lanes.large?.model]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      if (props.pane.kind === "new-provider") {
        const created = await api<Provider>("/api/providers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, host, apiKey: apiKey || undefined, dialect: dialect || undefined }),
        });
        await props.onChanged(created.id);
      } else {
        await api(`/api/providers/${existing!.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, host, apiKey: apiKey || undefined, dialect: dialect || undefined }),
        });
        await props.onChanged(existing!.id);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadModels() {
    if (props.pane.kind !== "provider") {
      setError(t.saveFirstModels);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{ models: string[] }>(`/api/providers/${existing!.id}/models`);
      setModels(result.models);
      if (result.models[0] && !largeModel) setLargeModel(result.models[0]);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function useIt() {
    if (props.pane.kind !== "provider") {
      setError(t.saveFirst);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/lanes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          large: { providerId: existing!.id, model: largeModel || undefined },
        }),
      });
      await props.onChanged(existing!.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (props.pane.kind !== "provider") return;
    setBusy(true);
    try {
      await api(`/api/providers/${existing!.id}`, { method: "DELETE" });
      await props.onChanged();
      props.onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, props.onClose]);

  return (
    <div className="modal-root provider-modal-root" role="dialog" aria-modal="true" aria-labelledby="provider-modal-title">
      <button type="button" className="modal-backdrop" aria-label={t.close} onClick={props.onClose} />
      <section className="provider-modal">
      <header className="provider-modal-head">
        <div>
          <span className="section-kicker">{t.connection}</span>
          <h2 id="provider-modal-title">{props.pane.kind === "new-provider" ? t.newProvider : existing?.name ?? t.provider}</h2>
          <p className="lede">{props.pane.kind === "new-provider" ? t.providerCreateHint : t.providerEditHint}</p>
        </div>
        <button type="button" className="modal-close" onClick={props.onClose} aria-label={t.close}>×</button>
      </header>
      <div className="provider-modal-body">
        <section className="settings-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{t.connection}</span>
              <h3>{t.connectionDetails}</h3>
              <p>{t.connectionDetailsHint}</p>
            </div>
            {existing ? (
              <span className="connection-badge connected"><span className="status-dot" />{existing.kind}</span>
            ) : null}
          </div>
          <div className="provider-form-grid">
            <div className="field-group">
              <label>{t.noteTitle}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field-group">
              <label>{t.dialect}</label>
              <select value={dialect} onChange={(e) => setDialect(e.target.value)} disabled={existing?.kind === "stub"}>
                <option value="">{t.dialectAuto}</option>
                {["llamacpp", "ollama", "vllm", "openai-custom", "openai", "groq", "openrouter", "anthropic"].map((id) => (
                  <option key={id} value={id}>{id}</option>
                ))}
              </select>
            </div>
            <div className="field-group span-2">
              <label>{t.host}</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="http://127.0.0.1:11434/v1" disabled={existing?.kind === "stub"} />
            </div>
            <div className="field-group span-2">
              <label>{t.apiKey} {existing?.hasKey ? t.apiKeySaved : t.apiKeyOptional}</label>
              <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" placeholder={existing?.hasKey ? "••••••••" : t.apiKeyOptional} />
            </div>
          </div>
          {error ? <div className="error">{error}</div> : null}
          <div className="section-actions">
            <button className="primary compact" disabled={busy} onClick={() => void save()}>{t.saveConnection}</button>
          </div>
        </section>

        <section className="settings-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{t.model}</span>
              <h3>{t.modelSelection}</h3>
              <p>{t.modelSelectionHint}</p>
            </div>
            <button className="secondary-button" disabled={busy || props.pane.kind === "new-provider"} onClick={() => void loadModels()}>{t.loadModels}</button>
          </div>
          <div className="field-group">
            <label>{t.largeModel}</label>
            {models.length > 0 ? (
              <select value={largeModel} onChange={(e) => setLargeModel(e.target.value)}>
                {(largeModel && !models.includes(largeModel) ? [largeModel, ...models] : models).map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            ) : (
              <input value={largeModel} onChange={(e) => setLargeModel(e.target.value)} placeholder={t.modelPlaceholder} />
            )}
          </div>
          <div className="section-actions">
            <button className="primary compact" disabled={busy || props.pane.kind === "new-provider"} onClick={() => void useIt()}>{t.useLanes}</button>
          </div>
        </section>

        {existing && existing.name !== "stub" ? (
          <section className={`settings-section danger-zone ${confirmRemove ? "confirming" : ""}`}>
            <div>
              <h3>{t.deleteConnection}</h3>
              <p>{confirmRemove ? t.deleteConnectionConfirm : t.deleteConnectionHint}</p>
            </div>
            <div className="danger-actions">
              {confirmRemove ? (
                <button className="secondary-button" disabled={busy} onClick={() => setConfirmRemove(false)}>{t.cancel}</button>
              ) : null}
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => confirmRemove ? void remove() : setConfirmRemove(true)}
              >
                {confirmRemove ? t.confirmDelete : t.delete}
              </button>
            </div>
          </section>
        ) : null}
      </div>
      </section>
    </div>
  );
}
