import { useEffect, useMemo, useState } from "react";
import { api, jsonBody } from "./api.ts";
import { useLocale } from "./LocaleContext.tsx";
import type { MemoryNote } from "./types.ts";

export function MemoryPage() {
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [selected, setSelected] = useState<MemoryNote | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const { t } = useLocale();

  async function load(nextQuery = query) {
    const listed = await api<MemoryNote[]>(`/api/memory?q=${encodeURIComponent(nextQuery)}&limit=80`);
    setNotes(listed);
    return listed;
  }

  useEffect(() => {
    void load().catch((err) => setError(String(err)));
  }, []);

  const tagFilters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [notes]);

  function open(note: MemoryNote) {
    setCreating(false);
    setSelected(note);
    setTitle(note.title);
    setBody(note.body);
    setTags(note.tags.join(", "));
    setError("");
  }

  function beginNew() {
    setCreating(true);
    setSelected(null);
    setTitle("");
    setBody("");
    setTags("operator");
    setError("");
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = await api<MemoryNote>("/api/memory", {
        method: "PUT",
        ...jsonBody({
          key: selected?.key,
          title,
          body,
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
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
    if (!selected) return;
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
          <div className="chip-row">
            {tagFilters.map(([tag, count]) => (
              <button
                key={tag}
                type="button"
                className={`chip ${query === tag ? "active" : ""}`}
                onClick={() => {
                  setQuery(tag);
                  void load(tag).catch((err) => setError(String(err)));
                }}
              >
                {tag} {count}
              </button>
            ))}
          </div>
          <div className="stack">
            {notes.length === 0 ? <div className="muted">{t.noNotes}</div> : notes.map((note) => (
              <button
                key={note.id}
                type="button"
                className={`card-main list-item ${selected?.id === note.id ? "current" : ""}`}
                onClick={() => open(note)}
              >
                <div className="card-title">{note.title}</div>
                <div className="meta"><span className="mono">{note.key}</span></div>
                <div className="preview">{note.body.replace(/\s+/g, " ").slice(0, 120)}</div>
              </button>
            ))}
          </div>
        </aside>
        <div className="detail-pane">
          {creating || selected ? (
            <>
              <label htmlFor="memory-title">{t.noteTitle}</label>
              <input id="memory-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <label htmlFor="memory-tags">{t.noteTags}</label>
              <input id="memory-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="rule, session, operator" />
              <label htmlFor="memory-body">{t.noteBody}</label>
              <textarea id="memory-body" value={body} onChange={(e) => setBody(e.target.value)} rows={16} />
              {selected ? <div className="muted mono">{selected.key}</div> : null}
              {error ? <div className="error" role="alert">{error}</div> : null}
              <div className="settings-actions">
                <button className="primary" type="button" disabled={busy} onClick={() => void save()}>{t.save}</button>
                {selected && !/^(samost|design)\//.test(selected.key) ? (
                  <button className="item danger" type="button" disabled={busy} onClick={() => void remove()}>{t.delete}</button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="muted">{t.notePick}</div>
          )}
        </div>
      </div>
    </section>
  );
}
