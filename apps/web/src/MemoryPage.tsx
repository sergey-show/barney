import { memoryShelf } from "@domain/memory/experienceGraph.ts";
import { useEffect, useMemo, useState } from "react";
import { api, jsonBody } from "./api.ts";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
import { ExperienceGraphView } from "./ExperienceGraph.tsx";
import { useLocale } from "./LocaleContext.tsx";
import { plainPreview } from "./mdPreview.ts";
import type { ExperienceGraph, MemoryNote } from "./types.ts";

type Shelf = "yours" | "learned" | "graph";

function shelfOf(note: MemoryNote) {
  return memoryShelf({ key: note.key, tags: note.tags ?? [] });
}

export function MemoryPage() {
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [graph, setGraph] = useState<ExperienceGraph>({ nodes: [], edges: [] });
  const [selected, setSelected] = useState<MemoryNote | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [shelf, setShelf] = useState<Shelf>("yours");
  const { t } = useLocale();

  async function load(nextQuery = query) {
    const listed = await api<MemoryNote[]>(`/api/memory?q=${encodeURIComponent(nextQuery)}&limit=80`);
    setNotes(listed);
    return listed;
  }

  async function loadGraph() {
    setGraph(await api<ExperienceGraph>("/api/memory/graph?limit=80"));
  }

  useEffect(() => {
    void load().catch((err) => setError(String(err)));
    void loadGraph().catch((err) => setError(String(err)));
  }, []);

  const visible = useMemo(() => {
    if (shelf === "graph") return [];
    return notes.filter((note) => shelfOf(note) === shelf);
  }, [notes, shelf]);
  const yoursCount = useMemo(() => notes.filter((note) => shelfOf(note) === "yours").length, [notes]);
  const learnedCount = useMemo(() => notes.filter((note) => shelfOf(note) === "learned").length, [notes]);

  function open(note: MemoryNote) {
    setCreating(false);
    setSelected(note);
    setTitle(note.title);
    setBody(note.body);
    setError("");
    const next = shelfOf(note);
    if (next === "learned" || next === "yours") setShelf(next);
  }

  async function openKey(key: string) {
    const listed = notes.find((note) => note.key === key);
    if (listed) {
      open(listed);
      return;
    }
    try {
      const note = await api<MemoryNote>(`/api/memory/${encodeURIComponent(key)}`);
      open(note);
    } catch {
      setCreating(false);
    }
  }

  function pickShelf(next: Shelf) {
    setShelf(next);
    setCreating(false);
    setError("");
    if (next === "graph") {
      void loadGraph().catch((err) => setError(String(err)));
      return;
    }
    if (selected && shelfOf(selected) !== next) {
      setSelected(null);
      setTitle("");
      setBody("");
    }
  }

  function beginNew() {
    setShelf("yours");
    setCreating(true);
    setSelected(null);
    setTitle("");
    setBody("");
    setError("");
  }

  const editing = creating || (shelf === "yours" && selected !== null && shelfOf(selected) === "yours");
  const viewingLearned = !creating && selected !== null && (shelf === "learned" || shelfOf(selected) === "learned");

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      const saved = await api<MemoryNote>("/api/memory", {
        method: "PUT",
        ...jsonBody({
          key: selected?.key,
          title,
          body,
          tags: ["operator"],
        }),
      });
      await load();
      open(saved);
      setCreating(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected || shelfOf(selected) !== "yours") return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/memory/${encodeURIComponent(selected.key)}`, { method: "DELETE" });
      setSelected(null);
      setCreating(false);
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page split memory-page">
      <header className="page-head">
        <div>
          <h2>{t.notesTitle}</h2>
          <p className="lede">{t.notesLede}</p>
          <div className="memory-summary">
            <span>{yoursCount} {t.notesYours.toLowerCase()}</span>
            <span>{learnedCount} {t.notesLearned.toLowerCase()}</span>
            <span>{graph.edges.length} {t.graphConnections.toLowerCase()}</span>
          </div>
        </div>
        <button className="primary" type="button" onClick={beginNew}>{t.newNote}</button>
      </header>
      <div className={`split-body ${shelf === "graph" ? "graph-full" : ""}`}>
        <aside className="list-pane">
          <div className="memory-tabs" role="tablist" aria-label={t.notesTitle}>
            <button type="button" className={shelf === "yours" ? "active" : ""} onClick={() => pickShelf("yours")}>
              <span className="memory-tab-icon note" />
              <span><strong>{t.notesYours}</strong><small>{t.notesYoursHint}</small></span>
              <b>{yoursCount}</b>
            </button>
            <button type="button" className={shelf === "learned" ? "active" : ""} onClick={() => pickShelf("learned")}>
              <span className="memory-tab-icon learned" />
              <span><strong>{t.notesLearned}</strong><small>{t.notesLearnedHint}</small></span>
              <b>{learnedCount}</b>
            </button>
            <button
              type="button"
              className={shelf === "graph" ? "active" : ""}
              onClick={() => pickShelf("graph")}
            >
              <span className="memory-tab-icon graph" />
              <span><strong>{t.notesGraph}</strong><small>{t.notesGraphHint}</small></span>
              <b>{graph.edges.length}</b>
            </button>
          </div>
          {shelf !== "graph" ? (
            <>
              <label className="memory-search" htmlFor="memory-search">
                <span aria-hidden="true">⌕</span>
                <input
                  id="memory-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void load(query).catch((err) => setError(String(err)));
                  }}
                  placeholder={t.searchNotesPh}
                />
              </label>
              <div className="memory-list">
                {visible.length === 0 ? <div className="memory-list-empty">{t.noNotes}</div> : visible.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className={`memory-note-row ${selected?.id === note.id ? "current" : ""}`}
                    onClick={() => open(note)}
                  >
                    <span className={`memory-note-mark ${shelfOf(note)}`} />
                    <span className="memory-note-copy">
                      <strong>{note.title}</strong>
                      <span>{plainPreview(note.body)}</span>
                      <small>
                        <time>{formatNoteDate(note.updatedAt)}</time>
                        {(note.tags ?? []).filter((tag) => !["operator", "lesson", "rule"].includes(tag)).slice(0, 2).map((tag) => (
                          <i key={tag}>{tag}</i>
                        ))}
                      </small>
                    </span>
                    <span className="memory-note-arrow">›</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="memory-graph-guide">
              <strong>{t.graphGuideTitle}</strong>
              <p>{t.graphGuideHint}</p>
            </div>
          )}
        </aside>
        <div className={`detail-pane ${shelf === "graph" ? "graph-stage" : ""}`}>
          {shelf === "graph" ? (
            <ExperienceGraphView
              graph={graph}
              selected={selected?.key}
              onSelect={(id) => void openKey(id)}
              empty={t.graphEmpty}
              kinds={{ class: t.graphClass, rule: t.graphRule, plugin: t.graphPlugin, note: t.graphNote }}
              edgeKinds={{ "failed-as": t.graphFailedAs, learned: t.graphLearnedEdge, "recovered-by": t.graphRecovered }}
              labels={{
                overview: t.graphOverview,
                nodes: t.graphNodes,
                connections: t.graphConnections,
                selectHint: t.graphSelectHint,
                connectedTo: t.graphConnectedTo,
                openDetails: t.graphOpenDetails,
                noConnections: t.graphNoConnections,
              }}
            />
          ) : creating || selected ? (
            <div className="memory-editor">
              <div className="memory-editor-head">
                <div>
                  <span className={`memory-source ${viewingLearned ? "learned" : "yours"}`}>
                    {viewingLearned ? t.notesLearned : t.notesYours}
                  </span>
                  {selected ? <time>{t.noteUpdated} {formatNoteDate(selected.updatedAt)}</time> : null}
                </div>
                {viewingLearned ? <span className="readonly-badge">{t.learnedReadOnly}</span> : null}
              </div>
              <label htmlFor="memory-title">{t.noteTitle}</label>
              <input id="memory-title" value={title} onChange={(e) => setTitle(e.target.value)} readOnly={!editing} />
              <label htmlFor="memory-body">{t.noteBody}</label>
              <MarkdownEditor
                key={selected?.id ?? "new"}
                id="memory-body"
                value={body}
                readOnly={!editing}
                placeholder={t.noteBodyPh}
                onChange={setBody}
              />
              {error ? <div className="error" role="alert">{error}</div> : null}
              {editing ? (
                <div className="settings-actions">
                  <button className="primary" type="button" disabled={busy || !title.trim() || !body.trim()} onClick={() => void save()}>{t.save}</button>
                  {selected ? (
                    <button className="item danger" type="button" disabled={busy} onClick={() => void remove()}>{t.delete}</button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty-panel memory-empty">
              <i>◇</i>
              <strong>{t.notePickTitle}</strong>
              <span>{shelf === "learned" ? t.notePickLearnedHint : t.notePick}</span>
              {shelf === "yours" ? <button className="secondary-button" type="button" onClick={beginNew}>{t.newNote}</button> : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function formatNoteDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
