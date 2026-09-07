import { useEffect, useMemo, useState } from "react";
import type { ExperienceEdge, ExperienceGraph as GraphData, ExperienceNode } from "./types.ts";

const KIND_FILL: Record<string, string> = {
  class: "var(--neon-blue)",
  rule: "var(--neon-pink)",
  plugin: "var(--neon-lime)",
  note: "var(--neon-gold)",
};

const EDGE_CLASS: Record<ExperienceEdge["kind"], string> = {
  "failed-as": "failed-as",
  learned: "learned",
  "recovered-by": "recovered-by",
};

type LaidNode = ExperienceNode & { x: number; y: number; r: number };

export function ExperienceGraphView(props: {
  graph: GraphData;
  selected?: string;
  onSelect: (id: string) => void;
  empty: string;
  kinds: { class: string; rule: string; plugin: string; note: string };
  edgeKinds: { "failed-as": string; learned: string; "recovered-by": string };
  labels: {
    overview: string;
    nodes: string;
    connections: string;
    selectHint: string;
    connectedTo: string;
    openDetails: string;
    noConnections: string;
  };
}) {
  const layout = useMemo(() => layoutForce(props.graph), [props.graph]);
  const byId = useMemo(() => new Map(layout.nodes.map((node) => [node.id, node])), [layout.nodes]);
  const [hover, setHover] = useState<string>();
  const [picked, setPicked] = useState<string | undefined>(props.selected);
  useEffect(() => setPicked(props.selected), [props.selected]);
  if (!props.graph.nodes.length) {
    return <div className="muted">{props.empty}</div>;
  }
  const { width, height, originX, originY, nodes, edges } = layout;
  const focus = hover ?? picked;
  const selectedNode = props.graph.nodes.find((node) => node.id === picked);
  const related = selectedNode
    ? props.graph.edges.flatMap((edge) => {
      if (edge.src !== selectedNode.id && edge.dst !== selectedNode.id) return [];
      const otherId = edge.src === selectedNode.id ? edge.dst : edge.src;
      const other = props.graph.nodes.find((node) => node.id === otherId);
      return other ? [{ edge, other }] : [];
    })
    : [];

  return (
    <div className="graph-wrap">
      <div className="graph-summary">
        <div>
          <strong>{props.labels.overview}</strong>
          <span>{props.labels.selectHint}</span>
        </div>
        <div className="graph-stats">
          <span><b>{nodes.length}</b>{props.labels.nodes}</span>
          <span><b>{edges.length}</b>{props.labels.connections}</span>
        </div>
      </div>
      <div className="graph-workspace">
        <div className="graph-canvas">
          <svg
            className="graph-svg"
            viewBox={`${originX} ${originY} ${width} ${height}`}
            role="img"
            aria-label="experience graph"
          >
            <defs>
              <radialGradient id="graph-glow" cx="50%" cy="42%" r="55%">
                <stop offset="0%" stopColor="rgb(77 163 255 / 0.13)" />
                <stop offset="55%" stopColor="rgb(255 77 154 / 0.04)" />
                <stop offset="100%" stopColor="rgb(0 0 0 / 0)" />
              </radialGradient>
              <filter id="node-glow" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="1.4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <rect
              x={originX}
              y={originY}
              width={width}
              height={height}
              fill="url(#graph-glow)"
              pointerEvents="none"
            />
            {edges.map((edge) => {
              const a = byId.get(edge.src);
              const b = byId.get(edge.dst);
              if (!a || !b) return null;
              const hot = focus === edge.src || focus === edge.dst;
              return (
                <line
                  key={`${edge.src}-${edge.kind}-${edge.dst}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={`graph-edge ${EDGE_CLASS[edge.kind]}${hot ? " is-hot" : ""}`}
                />
              );
            })}
            {nodes.map((node) => {
              const on = focus === node.id;
              const labeled = on || node.r >= 7;
              return (
                <g
                  key={node.id}
                  className={`graph-node ${picked === node.id ? "is-selected" : ""}`}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() => setPicked(node.id)}
                  onMouseEnter={() => setHover(node.id)}
                  onMouseLeave={() => setHover(undefined)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setPicked(node.id);
                  }}
                >
                  <title>{node.title}</title>
                  <circle
                    r={node.r}
                    fill={KIND_FILL[node.kind] ?? KIND_FILL.note}
                    filter="url(#node-glow)"
                  />
                  {labeled ? (
                    <text x={node.r + 5} y={4} className={on ? "is-hot" : undefined}>
                      {clipLabel(node.title)}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
        <aside className="graph-inspector">
          {selectedNode ? (
            <>
              <span className={`graph-kind ${selectedNode.kind}`}>{props.kinds[selectedNode.kind]}</span>
              <h3>{selectedNode.title}</h3>
              <code>{selectedNode.id}</code>
              <h4>{props.labels.connectedTo} <span>{related.length}</span></h4>
              <div className="graph-relations">
                {related.length ? related.map(({ edge, other }) => (
                  <button type="button" key={`${edge.src}-${edge.kind}-${edge.dst}`} onClick={() => setPicked(other.id)}>
                    <i className={`swatch ${other.kind}`} />
                    <span><strong>{other.title}</strong><small>{props.edgeKinds[edge.kind]}</small></span>
                  </button>
                )) : <p>{props.labels.noConnections}</p>}
              </div>
              {selectedNode.kind !== "class" ? (
                <button className="secondary-button graph-open" type="button" onClick={() => props.onSelect(selectedNode.id)}>
                  {props.labels.openDetails}
                </button>
              ) : null}
            </>
          ) : (
            <div className="graph-inspector-empty">{props.labels.selectHint}</div>
          )}
        </aside>
      </div>
      <div className="graph-legend">
        <span><i className="swatch class" />{props.kinds.class}</span>
        <span><i className="swatch rule" />{props.kinds.rule}</span>
        <span><i className="swatch plugin" />{props.kinds.plugin}</span>
        <span><i className="swatch note" />{props.kinds.note}</span>
        <span>{props.edgeKinds["failed-as"]} · {props.edgeKinds.learned} · {props.edgeKinds["recovered-by"]}</span>
      </div>
    </div>
  );
}

export function layoutForce(graph: GraphData, width = 900, height = 640) {
  const n = graph.nodes.length;
  if (!n) return { width, height, originX: 0, originY: 0, nodes: [] as LaidNode[], edges: graph.edges };

  const deg = new Map<string, number>();
  for (const node of graph.nodes) deg.set(node.id, 0);
  for (const edge of graph.edges) {
    deg.set(edge.src, (deg.get(edge.src) ?? 0) + 1);
    deg.set(edge.dst, (deg.get(edge.dst) ?? 0) + 1);
  }

  const bodies: Array<LaidNode & { vx: number; vy: number }> = graph.nodes.map((node, i) => {
    const seed = hashId(node.id);
    const angle = (i / n) * Math.PI * 2 + (seed % 97) / 250;
    const rad = 36 + (seed % 90);
    return {
      ...node,
      x: width / 2 + Math.cos(angle) * rad,
      y: height / 2 + Math.sin(angle) * rad,
      vx: 0,
      vy: 0,
      r: 3.2 + Math.min(11, (deg.get(node.id) ?? 0) * 1.7),
    };
  });
  const byId = new Map(bodies.map((body) => [body.id, body]));
  const ticks = Math.min(320, 110 + n * 3);

  for (let t = 0; t < ticks; t++) {
    const alpha = 1 - t / ticks;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = bodies[i];
        const b = bodies[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.04) {
          dx = 0.4;
          dy = 0.3;
          d2 = 0.25;
        }
        const dist = Math.sqrt(d2);
        const force = (380 * alpha) / d2;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }
    for (const edge of graph.edges) {
      const a = byId.get(edge.src);
      const b = byId.get(edge.dst);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const rest = 26 + a.r + b.r;
      const pull = (dist - rest) * 0.042 * alpha;
      const fx = (dx / dist) * pull;
      const fy = (dy / dist) * pull;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    for (const body of bodies) {
      body.vx += (width / 2 - body.x) * 0.01 * alpha;
      body.vy += (height / 2 - body.y) * 0.01 * alpha;
      body.vx *= 0.84;
      body.vy *= 0.84;
      body.x += body.vx;
      body.y += body.vy;
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const body of bodies) {
    minX = Math.min(minX, body.x - body.r);
    minY = Math.min(minY, body.y - body.r);
    maxX = Math.max(maxX, body.x + body.r);
    maxY = Math.max(maxY, body.y + body.r);
  }
  const pad = 52;
  return {
    width: Math.max(280, maxX - minX + pad * 2),
    height: Math.max(220, maxY - minY + pad * 2),
    originX: minX - pad,
    originY: minY - pad,
    nodes: bodies,
    edges: graph.edges,
  };
}

function hashId(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function clipLabel(title: string): string {
  const text = title.replace(/\s+/g, " ").trim();
  return text.length > 28 ? `${text.slice(0, 27)}…` : text;
}
