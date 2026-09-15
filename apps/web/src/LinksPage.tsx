import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { ExperienceGraphView } from "./ExperienceGraph.tsx";
import { useLocale } from "./LocaleContext.tsx";
import type { ExperienceGraph } from "./types.ts";

export function LinksPage(props: { onOpenNote: (key: string) => void }) {
  const [graph, setGraph] = useState<ExperienceGraph>({ nodes: [], edges: [] });
  const [error, setError] = useState("");
  const { t } = useLocale();

  useEffect(() => {
    void api<ExperienceGraph>("/api/memory/graph?limit=80")
      .then(setGraph)
      .catch((err) => setError(String(err)));
  }, []);

  return (
    <section className="page links-page">
      <header className="page-head">
        <div>
          <h2>{t.linksTitle}</h2>
          <p className="lede">{t.linksLede}</p>
        </div>
      </header>
      <div className="page-body graph-stage">
        {error ? <div className="error" role="alert">{error}</div> : null}
        <ExperienceGraphView
          graph={graph}
          onSelect={props.onOpenNote}
          empty={t.graphEmpty}
          roles={{
            shadow: t.graphShadow,
            skill: t.graphSkill,
            verified: t.graphVerified,
            episode: t.graphEpisode,
            kernel: t.graphKernel,
          }}
          edgeKinds={{ recall: t.graphRecall, transfer: t.graphTransfer }}
          labels={{
            overview: t.graphOverview,
            nodes: t.graphNodes,
            connections: t.graphConnections,
            pulses: t.graphPulses,
            edgeLegend: t.graphEdgeLegend,
            selectHint: t.graphSelectHint,
            connectedTo: t.graphConnectedTo,
            openDetails: t.graphOpenDetails,
            noConnections: t.graphNoConnections,
            roleTitle: t.graphRoleTitle,
            kernelRole: t.graphKernelRole,
            shadowRole: t.graphShadowRole,
            skillRole: t.graphSkillRole,
            verifiedRole: t.graphVerifiedRole,
            episodeRole: t.graphEpisodeRole,
          }}
        />
      </div>
    </section>
  );
}
