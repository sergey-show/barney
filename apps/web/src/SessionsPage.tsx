import { useMemo, useState } from "react";
import { useLocale } from "./LocaleContext.tsx";
import { lastActivity, type Run } from "./types.ts";

export function SessionsPage(props: {
  sessions: Run[];
  currentId?: string;
  onNew: () => void;
  onOpen: (id: string) => void;
  onCloseSession: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items = needle
      ? props.sessions.filter((session) => `${session.goal} ${session.status} ${session.id}`.toLowerCase().includes(needle))
      : props.sessions;
    return [...items].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
  }, [props.sessions, query]);
  const { t } = useLocale();
  const open = filtered.filter((session) => session.status !== "done");
  const closed = filtered.filter((session) => session.status === "done");

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h2>{t.sessionsTitle}</h2>
          <p className="lede">{t.sessionsLede}</p>
        </div>
        <button className="primary" type="button" onClick={props.onNew}>{t.newChat}</button>
      </header>
      <div className="page-body">
        <label htmlFor="session-search">{t.searchSessions}</label>
        <input
          id="session-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.searchSessionsPh}
        />
        <Group title={t.openGroup} items={open} empty={t.noOpen} currentId={props.currentId} onOpen={props.onOpen} onCloseSession={props.onCloseSession} closeLabel={t.closeChat} untitled={t.untitled} running={t.running} />
        <Group title={t.closedGroup} items={closed} empty={t.noClosed} currentId={props.currentId} onOpen={props.onOpen} untitled={t.untitled} running={t.running} />
      </div>
    </section>
  );
}

function Group(props: {
  title: string;
  items: Run[];
  empty: string;
  currentId?: string;
  onOpen: (id: string) => void;
  onCloseSession?: (id: string) => void;
  closeLabel?: string;
  untitled: string;
  running: string;
}) {
  return (
    <div className="stack">
      <h3>{props.title} <span className="count">{props.items.length}</span></h3>
      {props.items.length === 0 ? <div className="muted">{props.empty}</div> : props.items.map((session) => {
        const last = session.transcript.filter((item) => item.kind === "user" || item.kind === "assistant").at(-1);
        return (
          <article key={session.id} className={`card ${session.id === props.currentId ? "current" : ""}`}>
            <button type="button" className="card-main" onClick={() => props.onOpen(session.id)}>
              <div className="card-title">{session.goal || props.untitled}</div>
              <div className="meta">
                <span className={`pill status-${session.status}`}>{session.running ? props.running : session.status}</span>
                <span>{lastActivity(session) || session.id.slice(0, 8)}</span>
              </div>
              {last ? <div className="preview">{last.kind}: {last.text.replace(/\s+/g, " ").slice(0, 140)}</div> : null}
            </button>
            {props.onCloseSession && session.status !== "done" ? (
              <button type="button" className="item ghost" onClick={() => props.onCloseSession?.(session.id)}>{props.closeLabel}</button>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
