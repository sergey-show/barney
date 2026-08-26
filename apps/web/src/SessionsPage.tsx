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
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const items = needle
      ? props.sessions.filter((session) => `${session.goal} ${session.status} ${session.id}`.toLowerCase().includes(needle))
      : props.sessions;
    return [...items].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)));
  }, [props.sessions, query]);
  const { t } = useLocale();
  const pager = usePager(filtered);

  useEffect(() => {
    pager.setPage(0);
  }, [query]);

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
        <label htmlFor="session-search">{t.searchSessions}</label>
        <input
          id="session-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.searchSessionsPh}
        />
        {filtered.length === 0 ? (
          <div className="muted">{t.noSessions}</div>
        ) : (
          <>
            <div className="plain-list">
              {pager.slice.map((session) => (
                <div key={session.id} className={`plain-row ${session.id === props.currentId ? "current" : ""}`}>
                  <button type="button" className="plain-main" onClick={() => props.onOpen(session.id)}>
                    <div className="plain-title">{session.goal || t.untitled}</div>
                    <div className="plain-meta">
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
