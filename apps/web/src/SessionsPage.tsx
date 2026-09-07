import { useEffect, useMemo, useState } from "react";
import { useLocale } from "./LocaleContext.tsx";
import { Pager, usePager } from "./Pager.tsx";
import { lastActivity, type Run } from "./types.ts";

export function SessionsPage(props: {
  sessions: Run[];
  currentId?: string;
  onNew: () => void;
  onOpen: (id: string) => void;
  onCloseSession: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "open" | "done">("all");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const searched = needle
      ? props.sessions.filter((session) => `${session.goal} ${session.status} ${session.id}`.toLowerCase().includes(needle))
      : props.sessions;
    const items = searched.filter((session) => {
      if (scope === "open") return session.status !== "done";
      if (scope === "done") return session.status === "done";
      return true;
    });
    return [...items].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
  }, [props.sessions, query, scope]);
  const { t } = useLocale();
  const pager = usePager(filtered);
  const openCount = props.sessions.filter((session) => session.status !== "done").length;
  const doneCount = props.sessions.length - openCount;

  useEffect(() => {
    pager.setPage(0);
  }, [query, scope]);

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h2>{t.sessionsTitle}</h2>
          <p className="lede">{t.sessionsLede}</p>
        </div>
        <button className="primary" type="button" onClick={props.onNew}>{t.newChat}</button>
      </header>
      <div className="page-body wide">
        <div className="list-toolbar">
          <div className="chip-row" role="tablist" aria-label={t.sessionFilter}>
            <button type="button" className={`chip ${scope === "all" ? "active" : ""}`} onClick={() => setScope("all")}>
              {t.allSessions} <span className="count">{props.sessions.length}</span>
            </button>
            <button type="button" className={`chip ${scope === "open" ? "active" : ""}`} onClick={() => setScope("open")}>
              {t.openGroup} <span className="count">{openCount}</span>
            </button>
            <button type="button" className={`chip ${scope === "done" ? "active" : ""}`} onClick={() => setScope("done")}>
              {t.closedGroup} <span className="count">{doneCount}</span>
            </button>
          </div>
          <input
            id="session-search"
            aria-label={t.searchSessions}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchSessionsPh}
          />
        </div>
        {filtered.length === 0 ? (
          <div className="empty-panel">
            <strong>{query ? t.noSearchResults : t.noSessions}</strong>
            <span>{query ? t.noSearchResultsHint : t.noSessionsHint}</span>
          </div>
        ) : (
          <>
            <div className="plain-list">
              {pager.slice.map((session) => (
                <div key={session.id} className={`plain-row ${session.id === props.currentId ? "current" : ""}`}>
                  <button type="button" className="plain-main" onClick={() => props.onOpen(session.id)}>
                    <div className="plain-title">{session.goal || t.untitled}</div>
                    <div className="plain-meta">
                      <span className={`status-dot ${session.running ? "running" : session.status}`} />
                      {session.running ? t.running : session.status}
                      {" · "}
                      {lastActivity(session) || session.id.slice(0, 8)}
                    </div>
                  </button>
                  {session.status !== "done" ? (
                    <button type="button" className="plain-action" onClick={() => props.onCloseSession(session.id)}>
                      {t.closeChat}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <Pager page={pager.current} pages={pager.pages} onPage={pager.setPage} prev={t.prevPage} next={t.nextPage} />
          </>
        )}
      </div>
    </section>
  );
}
