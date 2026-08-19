import { memoryShelf } from "@domain/memory/experienceGraph.ts";
import { useEffect, useMemo, useState } from "react";
import { api, jsonBody } from "./api.ts";
import { ExperienceGraphView } from "./ExperienceGraph.tsx";
import { useLocale } from "./LocaleContext.tsx";
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
    <section className="page split">
      <header className="page-head">
        <div>
          <h2>{t.notesTitle}</h2>
          <p className="lede">{t.notesLede}</p>
        </div>
        <button className="primary" type="button" onClick={beginNew}>{t.newNote}</button>
      </header>
      <div className="split-body">
        <aside className="list-pane">
          <div className="chip-row">
            <button type="button" className={`chip ${shelf === "yours" ? "active" : ""}`} onClick={() => pickShelf("yours")}>
              {t.notesYours}
            </button>
            <button type="button" className={`chip ${shelf === "learned" ? "active" : ""}`} onClick={() => pickShelf("learned")}>
              {t.notesLearned}
            </button>
            <button
              type="button"
              className={`chip ${shelf === "graph" ? "active" : ""}`}
              onClick={() => pickShelf("graph")}
            >
              {t.notesGraph}
            </button>
          </div>
          {shelf !== "graph" ? (
            <>
              <p className="lede">{shelf === "yours" ? t.notesYoursHint : t.notesLearnedHint}</p>
              <label htmlFor="memory-search">{t.searchNotes}</label>
              <input
                id="memory-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void load(query).catch((err) => setError(String(err)));
                }}
                placeholder={t.searchNotesPh}
              />
              <div className="stack">
                {visible.length === 0 ? <div className="muted">{t.noNotes}</div> : visible.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className={`card-main list-item ${selected?.id === note.id ? "current" : ""}`}
                    onClick={() => open(note)}
                  >
                    <div className="card-title">{note.title}</div>
                    <div className="preview">{note.body.replace(/\s+/g, " ").slice(0, 120)}</div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="lede">{t.notesGraphHint}</p>
          )}
        </aside>
        <div className="detail-pane">
          {shelf === "graph" ? (
            <ExperienceGraphView
              graph={graph}
              selected={selected?.key}
              onSelect={(id) => void openKey(id)}
              empty={t.graphEmpty}
              kinds={{ class: t.graphClass, rule: t.graphRule, plugin: t.graphPlugin, note: t.graphNote }}
              edgeKinds={{ "failed-as": t.graphFailedAs, learned: t.graphLearnedEdge, "recovered-by": t.graphRecovered }}
            />
          ) : creating || selected ? (
            <>
              {viewingLearned ? <p className="lede">{t.learnedReadOnly}</p> : null}
              <label htmlFor="memory-title">{t.noteTitle}</label>
              <input id="memory-title" value={title} onChange={(e) => setTitle(e.target.value)} readOnly={!editing} />
              <label htmlFor="memory-body">{t.noteBody}</label>
              <textarea id="memory-body" value={body} onChange={(e) => setBody(e.target.value)} rows={16} readOnly={!editing} />
              {error ? <div className="error" role="alert">{error}</div> : null}
              {editing ? (
                <div className="settings-actions">
                  <button className="primary" type="button" disabled={busy} onClick={() => void save()}>{t.save}</button>
                  {selected ? (
                    <button className="item danger" type="button" disabled={busy} onClick={() => void remove()}>{t.delete}</button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="muted">{t.notePick}</div>
          )}
        </div>
      </div>
    </section>
  );
}
