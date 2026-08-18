import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { useLocale } from "./LocaleContext.tsx";
import { MarkdownBody } from "./MarkdownBody.tsx";
import type { FileEntry } from "./types.ts";

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const MARKDOWN = /\.(md|markdown)$/i;
const TEXT = /\.(txt|json|ts|tsx|js|jsx|css|html|yml|yaml|toml|sh|py|go|rs|c|h|md|log|env)$/i;

function parentOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

export function FilesPage(props: { sessionId?: string; initialPath?: string }) {
  const [dir, setDir] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState(props.initialPath ?? "");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const { t } = useLocale();

  async function loadDir(path: string) {
    if (!props.sessionId) return;
    const listed = await api<FileEntry[]>(`/api/sessions/${props.sessionId}/files?path=${encodeURIComponent(path)}`);
    setDir(path);
    setFiles(listed);
  }

  async function openEntry(entry: FileEntry) {
    if (entry.dir) {
      setSelected("");
      setText("");
      await loadDir(entry.path);
      return;
    }
    setSelected(entry.path);
    if (IMAGE.test(entry.name) || !TEXT.test(entry.name) && !MARKDOWN.test(entry.name)) {
      setText("");
      return;
    }
    const file = await api<{ path: string; text: string }>(
      `/api/sessions/${props.sessionId}/files/raw?path=${encodeURIComponent(entry.path)}`,
    );
    setText(file.text);
  }

  useEffect(() => {
    if (!props.sessionId) return;
    const start = props.initialPath && !IMAGE.test(props.initialPath) && props.initialPath.includes("/")
      ? parentOf(props.initialPath)
      : "";
    void loadDir(start).then(async () => {
      if (!props.initialPath) return;
      const listed = await api<FileEntry[]>(`/api/sessions/${props.sessionId}/files?path=${encodeURIComponent(start)}`);
      const hit = listed.find((item) => item.path === props.initialPath);
      if (hit) await openEntry(hit);
    }).catch((err) => setError(String(err)));
  }, [props.sessionId, props.initialPath]);

  if (!props.sessionId) {
    return (
      <section className="page">
        <header className="page-head">
          <div>
            <h2>{t.filesTitle}</h2>
            <p className="lede">{t.filesLede}</p>
          </div>
        </header>
        <div className="page-body"><div className="muted">{t.filesNeedSession}</div></div>
      </section>
    );
  }

  const crumbs = [t.worktree, ...dir.split("/").filter(Boolean)];
  const selectedName = selected.split("/").pop() ?? selected;
  const bytes = selected ? `/api/sessions/${props.sessionId}/files/bytes?path=${encodeURIComponent(selected)}` : "";

  return (
    <section className="page split">
      <header className="page-head">
        <div>
          <h2>{t.filesTitle}</h2>
          <p className="lede">{t.filesLede}</p>
        </div>
      </header>
      <div className="split-body">
        <aside className="list-pane">
          <nav className="crumbs" aria-label="Path">
            {crumbs.map((part, index) => {
              const path = crumbs.slice(1, index + 1).join("/");
              return (
                <button key={`${part}-${index}`} type="button" className="crumb" onClick={() => void loadDir(index === 0 ? "" : path)}>
                  {part}
                </button>
              );
            })}
          </nav>
          {error ? <div className="error" role="alert">{error}</div> : null}
          <div className="stack">
            {dir ? (
              <button type="button" className="card-main list-item" onClick={() => void loadDir(parentOf(dir))}>
                <div className="card-title">..</div>
                <div className="meta">Up</div>
              </button>
            ) : null}
            {files.length === 0 ? <div className="muted">Empty folder.</div> : files.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={`card-main list-item ${selected === entry.path ? "current" : ""}`}
                onClick={() => void openEntry(entry).catch((err) => setError(String(err)))}
              >
                <div className="card-title">{entry.dir ? `${entry.name}/` : entry.name}</div>
                <div className="meta"><span className="mono">{entry.path}</span></div>
              </button>
            ))}
          </div>
        </aside>
        <div className="detail-pane file-preview">
          {!selected ? (
            <div className="muted">Pick a file to preview.</div>
          ) : IMAGE.test(selectedName) ? (
            <img className="file-image" src={bytes} alt={selectedName} />
          ) : MARKDOWN.test(selectedName) ? (
            <MarkdownBody text={text} />
          ) : TEXT.test(selectedName) || text ? (
            <pre className="file-code"><code>{text}</code></pre>
          ) : (
            <div>
              <div className="muted">Binary or unknown type.</div>
              <a className="item" href={bytes} download={selectedName}>Download {selectedName}</a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
