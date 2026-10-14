import { useEffect, useState } from "react";
import { api, jsonBody } from "./api.ts";
import { useLocale } from "./LocaleContext.tsx";
import { Pager, usePager } from "./Pager.tsx";
import type { PsycheEvolution, PsycheState } from "./types.ts";

function linesOf(value: string): string[] {
  return value.split("\n").map((line) => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
}

function gaugeWidth(value: number, max: number): string {
  if (max <= 0) return "0%";
  return `${Math.min(100, Math.round((value / max) * 100))}%`;
}

export function PsychePage(props: { runId?: string }) {
  const [state, setState] = useState<PsycheState | null>(null);
  const [evolution, setEvolution] = useState<PsycheEvolution | null>(null);
  const [compass, setCompass] = useState("");
  const [character, setCharacter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { t } = useLocale();
  const episodePage = usePager(state?.episodes ?? []);

  async function load() {
    const q = props.runId ? `?runId=${encodeURIComponent(props.runId)}` : "";
    const [next, evo] = await Promise.all([
      api<PsycheState>(`/api/psyche${q}`),
      api<PsycheEvolution>(`/api/psyche/evolution${q}`),
    ]);
    setState(next);
    setEvolution(evo);
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
        <button className="primary compact" type="button" disabled={busy} onClick={() => void save()}>{t.saveCharacter}</button>
      </header>
      <div className="page-body psyche-page">
        <div className="psyche-summary">
          <div className="agent-avatar">{state.agent.name.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{state.agent.name}</strong>
            <span>{t.agentProfileMeta(String(state.agent.version), state.agent.taskClass)}</span>
          </div>
          <span className={`connection-badge ${state.designSealed ? "connected" : ""}`}>
            <span className="status-dot" />
            {state.designSealed ? t.designed : t.notSealed}
          </span>
        </div>

        <section className="psyche-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{t.identity}</span>
              <h3>{t.directionAndTraits}</h3>
              <p>{t.characterIntro}</p>
            </div>
          </div>
          <div className="character-fields">
            <div className="field-group">
            <label htmlFor="compass">{t.compass}</label>
            <p className="lede">{t.compassHint}</p>
            <textarea id="compass" value={compass} onChange={(e) => setCompass(e.target.value)} rows={4} />
            </div>
            <div className="field-group">
            <label htmlFor="character">{t.traits}</label>
            <p className="lede">{t.traitsHint}</p>
            <textarea id="character" value={character} onChange={(e) => setCharacter(e.target.value)} rows={5} />
            </div>
          </div>
        </section>

        {evolution ? (
          <section className="psyche-section">
            <div className="section-heading">
              <div>
                <span className="section-kicker">{t.experience}</span>
                <h3>{t.evolutionTitle}</h3>
                <p>{t.evolutionHint}</p>
              </div>
            </div>
            <div className="evolution-grid">
              <div className="evolution-gauge">
                <div className="evolution-gauge-head"><span>{t.evolutionShadow}</span><b>{evolution.shadowCount}</b></div>
                <div className="evolution-bar"><i style={{ width: gaugeWidth(evolution.shadowCount, Math.max(evolution.shadowCount, evolution.lightCount, 8)) }} /></div>
              </div>
              <div className="evolution-gauge">
                <div className="evolution-gauge-head"><span>{t.evolutionLight}</span><b>{evolution.lightCount}</b></div>
                <div className="evolution-bar light"><i style={{ width: gaugeWidth(evolution.lightCount, Math.max(evolution.shadowCount, evolution.lightCount, 8)) }} /></div>
              </div>
              <div className="evolution-gauge">
                <div className="evolution-gauge-head"><span>{t.evolutionQuarantine}</span><b>{evolution.skills.quarantineCount}</b></div>
                <div className="evolution-bar quarantine"><i style={{ width: gaugeWidth(evolution.skills.quarantineCount, Math.max(1, evolution.skills.quarantineCount + evolution.skills.verifiedCount + evolution.skills.frozenCount)) }} /></div>
                <small>{evolution.skills.quarantine.slice(0, 4).join(", ") || "—"}</small>
              </div>
              <div className="evolution-gauge">
                <div className="evolution-gauge-head"><span>{t.evolutionVerified}</span><b>{evolution.skills.verifiedCount}</b></div>
                <div className="evolution-bar verified"><i style={{ width: gaugeWidth(evolution.skills.verifiedCount, Math.max(1, evolution.skills.quarantineCount + evolution.skills.verifiedCount + evolution.skills.frozenCount)) }} /></div>
                <small>{evolution.skills.verified.slice(0, 4).join(", ") || "—"}</small>
              </div>
              <div className="evolution-gauge">
                <div className="evolution-gauge-head"><span>{t.evolutionFrozen}</span><b>{evolution.skills.frozenCount}</b></div>
                <div className="evolution-bar frozen"><i style={{ width: gaugeWidth(evolution.skills.frozenCount, Math.max(1, evolution.skills.quarantineCount + evolution.skills.verifiedCount + evolution.skills.frozenCount)) }} /></div>
                <small>{evolution.skills.frozen.slice(0, 4).join(", ") || "—"}</small>
              </div>
              <div className="evolution-gauge">
                <div className="evolution-gauge-head"><span>{t.evolutionFrustration}</span><b>{evolution.frustration ?? "—"}</b></div>
                <div className="evolution-bar frustration"><i style={{ width: gaugeWidth(evolution.frustration ?? 0, 8) }} /></div>
                <small>{evolution.frustration == null ? t.evolutionFrustrationNone : evolution.frustrationSource}</small>
              </div>
            </div>
            <div className="evolution-notes">
              <div>
                <strong>{t.evolutionDream}</strong>
                <p>{evolution.lastDreamSummary ?? t.evolutionNoDream}</p>
                {evolution.lastDreamAt ? <small>{new Date(evolution.lastDreamAt).toLocaleString()}</small> : null}
              </div>
              <div>
                <strong>{t.evolutionAgenda}</strong>
                <p>{evolution.agenda.nextGoal ?? t.evolutionNoAgenda}</p>
                <small>
                  pending {evolution.agenda.pending.length} · running {evolution.agenda.running.length}
                </small>
              </div>
            </div>
          </section>
        ) : null}

        <section className="psyche-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{t.experience}</span>
              <h3>{t.patternsTitle}</h3>
              <p>{t.patternsHint}</p>
            </div>
          </div>
          <div className="pattern-grid">
            <div className="pattern-card light">
              <div className="pattern-card-head"><span>↑</span><div><strong>{t.light}</strong><small>{t.lightHint}</small></div><b>{state.samost.light.length}</b></div>
              {state.samost.light.length === 0 ? <div className="section-empty compact">{t.emptyLight}</div> : (
                <ul className="psyche-list">{state.samost.light.map((line) => <li key={line}>{line}</li>)}</ul>
              )}
            </div>
            <div className="pattern-card shadow">
              <div className="pattern-card-head"><span>↓</span><div><strong>{t.shadow}</strong><small>{t.shadowHint}</small></div><b>{state.samost.shadow.length}</b></div>
              {state.samost.shadow.length === 0 ? <div className="section-empty compact">{t.emptyShadow}</div> : (
                <ul className="psyche-list shadow">{state.samost.shadow.map((line) => <li key={line}>{line}</li>)}</ul>
              )}
            </div>
          </div>
        </section>
        {error ? <div className="error" role="alert">{error}</div> : null}

        <section className="psyche-section">
          <div className="section-heading">
            <div>
              <span className="section-kicker">{t.history}</span>
              <h3>{t.episodes}</h3>
              <p>{t.episodesHint}</p>
            </div>
            <span className="count-badge">{state.episodes.length}</span>
          </div>
          {state.episodes.length === 0 ? (
            <div className="section-empty">{t.noEpisodes}</div>
          ) : (
            <>
              <div className="episode-list">
                {episodePage.slice.map((episode) => (
                  <div key={episode.id} className="episode-row">
                    <span className={`outcome-mark ${episode.outcome}`} />
                    <div className="plain-main">
                      <div className="plain-title">{episode.goal}</div>
                      <div className="plain-meta">
                        {episode.outcome}
                        {episode.failureMode ? ` · ${episode.failureMode}` : ""}
                      </div>
                    </div>
                    <span className="episode-date">{new Date(episode.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
              <Pager page={episodePage.current} pages={episodePage.pages} onPage={episodePage.setPage} prev={t.prevPage} next={t.nextPage} />
            </>
          )}
        </section>
      </div>
    </section>
  );
}
