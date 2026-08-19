import { useMemo } from "react";
import type { ExperienceGraph as GraphData } from "./types.ts";

const COL: Record<string, number> = { class: 0, rule: 1, plugin: 2, note: 1 };
const KIND_FILL: Record<string, string> = {
  class: "var(--secondary)",
  rule: "var(--accent)",
  plugin: "#86efac",
  note: "var(--muted)",
};

export function ExperienceGraphView(props: {
  graph: GraphData;
  selected?: string;
  onSelect: (id: string) => void;
  empty: string;
  kinds: { class: string; rule: string; plugin: string; note: string };
  edgeKinds: { "failed-as": string; learned: string; "recovered-by": string };
}) {
  const layout = useMemo(() => layoutGraph(props.graph), [props.graph]);
  if (!props.graph.nodes.length) {
    return <div className="muted">{props.empty}</div>;
  }
  const { width, height, nodes, edges } = layout;
  return (
    <div className="graph-wrap">
      <svg className="graph-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="experience graph">
        {edges.map((edge) => {
          const a = nodes.find((node) => node.id === edge.src);
          const b = nodes.find((node) => node.id === edge.dst);
          if (!a || !b) return null;
          return (
            <line
              key={`${edge.src}-${edge.kind}-${edge.dst}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className="graph-edge"
            />
          );
        })}
        {nodes.map((node) => (
          <g
            key={node.id}
            className={`graph-node ${props.selected === node.id ? "is-selected" : ""}`}
            transform={`translate(${node.x}, ${node.y})`}
            onClick={() => props.onSelect(node.id)}
          >
            <circle r={10} fill={KIND_FILL[node.kind] ?? KIND_FILL.note} />
            <text x={14} y={4}>{clipLabel(node.title)}</text>
          </g>
        ))}
      </svg>
      <div className="graph-legend">
        <span><i className="swatch class" />{props.kinds.class}</span>
        <span><i className="swatch rule" />{props.kinds.rule}</span>
        <span><i className="swatch plugin" />{props.kinds.plugin}</span>
        <span>{props.edgeKinds["failed-as"]} · {props.edgeKinds.learned} · {props.edgeKinds["recovered-by"]}</span>
      </div>
    </div>
  );
}

function layoutGraph(graph: GraphData) {
  const buckets: Record<string, typeof graph.nodes> = { class: [], rule: [], plugin: [], note: [] };
  for (const node of graph.nodes) {
    (buckets[node.kind] ?? buckets.note).push(node);
  }
  const colWidth = 220;
  const row = 36;
  const pad = 28;
  const height = Math.max(160, pad * 2 + Math.max(...Object.values(buckets).map((list) => list.length), 1) * row);
  const width = pad * 2 + 3 * colWidth;
  const placed = graph.nodes.map((node) => {
    const col = COL[node.kind] ?? 1;
    const list = buckets[node.kind] ?? buckets.note;
    const index = list.findIndex((item) => item.id === node.id);
    return {
      ...node,
      x: pad + col * colWidth + 12,
      y: pad + index * row + 12,
    };
  });
  return { width, height, nodes: placed, edges: graph.edges };
}

function clipLabel(title: string): string {
  const text = title.replace(/\s+/g, " ").trim();
  return text.length > 28 ? `${text.slice(0, 27)}…` : text;
}
