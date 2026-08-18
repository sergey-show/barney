import { useEffect, useState } from "react";
import { api, jsonBody } from "./api.ts";
import { useLocale } from "./LocaleContext.tsx";
import type { PsycheState } from "./types.ts";

function linesOf(value: string): string[] {
  return value.split("\n").map((line) => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
}

export function PsychePage(props: { runId?: string }) {
  const [state, setState] = useState<PsycheState | null>(null);
  const [compass, setCompass] = useState("");
  const [character, setCharacter] = useState("");
  const [light, setLight] = useState("");
  const [shadow, setShadow] = useState("");
  const [constitution, setConstitution] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { t } = useLocale();

  async function load() {
    const next = await api<PsycheState>(`/api/psyche${props.runId ? `?runId=${encodeURIComponent(props.runId)}` : ""}`);
    setState(next);
    setCompass(next.samost.compass);
    setCharacter(next.samost.character.join("\n"));
    setLight(next.samost.light.join("\n"));
    setShadow(next.samost.shadow.join("\n"));
    setConstitution(next.agent.constitution);
  }

  useEffect(() => {
    void load().catch((err) => setError(String(err)));
  }, [props.runId]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const next = await api<PsycheState>("/api/psyche", {
        method: "PATCH",
        ...jsonBody({
          compass,
          character: linesOf(character),
          light: linesOf(light),
          shadow: linesOf(shadow),
          constitution,
        }),
      });
      setState(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <section className="page">
        <header className="page-head"><h2>{t.characterTitle}</h2></header>
        <div className="page-body">{error ? <div className="error" role="alert">{error}</div> : <div className="muted">{t.loading}</div>}</div>
      </section>
    );
  }

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h2>{t.characterTitle}</h2>
          <p className="lede">{t.characterLede(state.agent.name, state.agent.version, state.designSealed)}</p>
        </div>
        <button className="primary" type="button" disabled={busy} onClick={() => void save()}>{t.saveCharacter}</button>
      </header>
      <div className="page-body wide">
        <div className="grid-2">
          <div>
            <label htmlFor="compass">{t.compass}</label>
            <p className="lede">{t.compassHint}</p>
            <textarea id="compass" value={compass} onChange={(e) => setCompass(e.target.value)} rows={4} />
            <label htmlFor="character">{t.traits}</label>
            <textarea id="character" value={character} onChange={(e) => setCharacter(e.target.value)} rows={5} />
            <label htmlFor="constitution">{t.constitution}</label>
            <textarea id="constitution" value={constitution} onChange={(e) => setConstitution(e.target.value)} rows={8} />
          </div>
          <div>
            <label htmlFor="light">{t.light}</label>
            <textarea id="light" value={light} onChange={(e) => setLight(e.target.value)} rows={6} />
            <label htmlFor="shadow">{t.shadow}</label>
            <textarea id="shadow" value={shadow} onChange={(e) => setShadow(e.target.value)} rows={6} />
          </div>
        </div>
        {error ? <div className="error" role="alert">{error}</div> : null}

        <h3>{t.currentSession}</h3>
        {props.runId ? (
          <div className="grid-2">
            <div className="stack">
              <h4>{t.existence}</h4>
              {state.existence.length === 0 ? <div className="muted">{t.emptyExistence}</div> : state.existence.map((block, index) => (
                <div key={`${block.at}-${index}`} className="card quiet">
                  <div className="meta"><span className="pill">{block.kind}</span><span>{block.at}</span></div>
                  <div>{block.text}</div>
                </div>
              ))}
            </div>
            <div className="stack">
              <h4>{t.board}</h4>
              {state.board.length === 0 ? <div className="muted">{t.emptyBoard}</div> : state.board.map((entry, index) => (
                <div key={`${entry.kind}-${index}`} className="card quiet">
                  <div className="meta"><span className={`pill kind-${entry.kind}`}>{entry.kind}</span></div>
                  <div>{entry.text}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="muted">{t.openSessionPsyche}</div>
        )}

        <h3>{t.episodes}</h3>
        <div className="stack">
          {state.episodes.length === 0 ? <div className="muted">{t.noEpisodes}</div> : state.episodes.map((episode) => (
            <div key={episode.id} className="card quiet">
              <div className="card-title">{episode.goal}</div>
              <div className="meta">
                <span className={`pill status-${episode.outcome}`}>{episode.outcome}</span>
                {episode.failureMode ? <span>{episode.failureMode}</span> : null}
              </div>
              {episode.nextHint ? <div className="preview">{episode.nextHint}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
