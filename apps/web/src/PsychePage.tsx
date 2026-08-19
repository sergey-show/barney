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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { t } = useLocale();

  async function load() {
    const next = await api<PsycheState>(`/api/psyche${props.runId ? `?runId=${encodeURIComponent(props.runId)}` : ""}`);
    setState(next);
    setCompass(next.samost.compass);
    setCharacter(next.samost.character.join("\n"));
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
          <p className="lede">{t.characterLede(state.agent.name, String(state.agent.version), state.designSealed)}</p>
        </div>
        <button className="primary" type="button" disabled={busy} onClick={() => void save()}>{t.saveCharacter}</button>
      </header>
      <div className="page-body wide">
        <p className="lede">{t.characterIntro}</p>
        <div className="grid-2">
          <div>
            <label htmlFor="compass">{t.compass}</label>
            <p className="lede">{t.compassHint}</p>
            <textarea id="compass" value={compass} onChange={(e) => setCompass(e.target.value)} rows={4} />
            <label htmlFor="character">{t.traits}</label>
            <p className="lede">{t.traitsHint}</p>
            <textarea id="character" value={character} onChange={(e) => setCharacter(e.target.value)} rows={5} />
          </div>
          <div>
            <h4>{t.light}</h4>
            <p className="lede">{t.lightHint}</p>
            {state.samost.light.length === 0 ? <div className="muted">{t.emptyLight}</div> : (
              <ul className="psyche-list">
                {state.samost.light.map((line) => <li key={line}>{line}</li>)}
              </ul>
            )}
            <h4>{t.shadow}</h4>
            <p className="lede">{t.shadowHint}</p>
            {state.samost.shadow.length === 0 ? <div className="muted">{t.emptyShadow}</div> : (
              <ul className="psyche-list shadow">
                {state.samost.shadow.map((line) => <li key={line}>{line}</li>)}
              </ul>
            )}
          </div>
        </div>
        {error ? <div className="error" role="alert">{error}</div> : null}

        <h3>{t.episodes}</h3>
        <p className="lede">{t.episodesHint}</p>
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
