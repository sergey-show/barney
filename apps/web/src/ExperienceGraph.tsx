import { useEffect, useMemo, useRef, useState } from "react";
import type { ExperienceEdge, ExperienceGraph as GraphData, ExperienceNode } from "./types.ts";

/** Self / cortex roles from the brain-synapses reference. */
export type CortexRole = "kernel" | "shadow" | "skill" | "verified" | "episode";

const ROLE_COLOR: Record<CortexRole, string> = {
  kernel: "#e6edf8",
  shadow: "#5b9cff",
  skill: "#e8a838",
  verified: "#3dceb0",
  episode: "#9b8af5",
};

/** dashed = recall, solid = transfer */
const EDGE_RGB = {
  recall: "232,168,56",
  transfer: "91,156,255",
  kernel: "140,190,255",
} as const;

export const KERNEL_ID = "__kernel__";

type VizNode = ExperienceNode & {
  role: CortexRole;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  r: number;
  phase: number;
  strength: number;
};

type VizEdge = {
  src: string;
  dst: string;
  synapse: "recall" | "transfer" | "kernel";
  labelKind?: ExperienceEdge["kind"];
  spoke?: boolean;
};

type Pulse = {
  src: string;
  dst: string;
  synapse: VizEdge["synapse"];
  t: number;
  speed: number;
};

type Frame = {
  W: number;
  H: number;
  CX: number;
  CY: number;
  SX: number;
  SY: number;
  hubId: string;
  nodes: VizNode[];
  byId: Map<string, VizNode>;
  edges: VizEdge[];
};

export function ExperienceGraphView(props: {
  graph: GraphData;
  selected?: string;
  onSelect: (id: string) => void;
  empty: string;
  roles: { shadow: string; skill: string; verified: string; episode: string; kernel: string };
  edgeKinds: { recall: string; transfer: string };
  labels: {
    overview: string;
    nodes: string;
    connections: string;
    pulses: string;
    edgeLegend: string;
    selectHint: string;
    connectedTo: string;
    openDetails: string;
    noConnections: string;
    roleTitle: string;
    kernelRole: string;
    shadowRole: string;
    skillRole: string;
    verifiedRole: string;
    episodeRole: string;
  };
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<Frame | null>(null);
  const pulsesRef = useRef<Pulse[]>([]);
  const hoverRef = useRef<string | undefined>(undefined);
  const pickedRef = useRef<string | undefined>(props.selected);
  const [picked, setPicked] = useState<string | undefined>(props.selected);
  const [hover, setHover] = useState<string>();
  const [pulseCount, setPulseCount] = useState(0);

  useEffect(() => {
    setPicked(props.selected);
    pickedRef.current = props.selected;
  }, [props.selected]);

  useEffect(() => {
    pickedRef.current = picked;
  }, [picked]);

  useEffect(() => {
    hoverRef.current = hover;
  }, [hover]);

  const hasData = props.graph.nodes.length > 0;

  useEffect(() => {
    if (!hasData) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let alive = true;
    let spawnTimer = 0;
    let resizeRaf = 0;
    let lastW = 0;
    let lastH = 0;

    function rebuild() {
      const rect = wrap!.getBoundingClientRect();
      const W = Math.max(1, Math.floor(rect.width));
      const H = Math.max(1, Math.floor(rect.height));
      if (W < 2 || H < 2) return;
      if (Math.abs(W - lastW) < 1 && Math.abs(H - lastH) < 1 && frameRef.current) return;
      lastW = W;
      lastH = H;
      canvas!.width = Math.floor(W * dprCap);
      canvas!.height = Math.floor(H * dprCap);
      ctx!.setTransform(dprCap, 0, 0, dprCap, 0, 0);
      frameRef.current = layoutBrain(props.graph, W, H);
      pulsesRef.current = [];
      setPulseCount(0);
    }

    function scheduleRebuild() {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        rebuild();
      });
    }

    function spawnPulse() {
      const frame = frameRef.current;
      if (!frame?.edges.length) return;
      const focus = pickedRef.current ?? hoverRef.current;
      let pool = focus
        ? frame.edges.filter((e) => e.src === focus || e.dst === focus)
        : frame.edges.filter((e) => e.spoke || e.synapse === "recall" || Math.random() > 0.35);
      if (!pool.length) pool = frame.edges;
      const edge = pool[Math.floor(Math.random() * pool.length)];
      if (!edge) return;
      const forward = Math.random() > 0.45;
      pulsesRef.current.push({
        src: forward ? edge.src : edge.dst,
        dst: forward ? edge.dst : edge.src,
        synapse: edge.synapse,
        t: 0,
        speed: 0.007 + Math.random() * 0.012,
      });
      if (pulsesRef.current.length > 48) pulsesRef.current.splice(0, pulsesRef.current.length - 48);
      setPulseCount(pulsesRef.current.length);
    }

    function paint(time: number) {
      if (!alive) return;
      const frame = frameRef.current;
      if (!frame) {
        raf = requestAnimationFrame(paint);
        return;
      }
      const { W, H, CX, CY, SX, SY, hubId, nodes, byId, edges } = frame;
      ctx!.clearRect(0, 0, W, H);
      drawBrain(ctx!, CX, CY, SX, SY);

      for (const edge of edges) {
        const a = byId.get(edge.src);
        const b = byId.get(edge.dst);
        if (!a || !b) continue;
        const focus = hoverRef.current ?? pickedRef.current;
        const hot = focus === edge.src || focus === edge.dst;
        const { mx, my } = edgeCurve(a, b);
        const rgb = EDGE_RGB[edge.synapse];
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.quadraticCurveTo(mx, my, b.x, b.y);
        if (edge.synapse === "recall") ctx!.setLineDash([3.5, 5]);
        else ctx!.setLineDash([]);
        const alpha = hot ? 0.55 : edge.spoke ? 0.22 : edge.synapse === "transfer" ? 0.28 : 0.2;
        ctx!.strokeStyle = `rgba(${rgb},${alpha})`;
        ctx!.lineWidth = hot ? 2 : edge.spoke ? 1.35 : 1.05;
        ctx!.stroke();
        ctx!.setLineDash([]);

        const t = 0.88;
        const bx = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x;
        const by = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
        ctx!.beginPath();
        ctx!.arc(bx, by, hot ? 2.4 : 1.6, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${rgb},${hot ? 0.75 : 0.4})`;
        ctx!.fill();
      }

      const pulses = pulsesRef.current;
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += p.speed;
        if (p.t >= 1) {
          pulses.splice(i, 1);
          continue;
        }
        const a = byId.get(p.src);
        const b = byId.get(p.dst);
        if (!a || !b) {
          pulses.splice(i, 1);
          continue;
        }
        const { mx, my } = edgeCurve(a, b);
        const t = p.t;
        const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x;
        const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
        const rgb = EDGE_RGB[p.synapse];
        const glow = ctx!.createRadialGradient(x, y, 0, x, y, 8);
        glow.addColorStop(0, `rgba(${rgb},0.95)`);
        glow.addColorStop(1, `rgba(${rgb},0)`);
        ctx!.fillStyle = glow;
        ctx!.beginPath();
        ctx!.arc(x, y, 8, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.beginPath();
        ctx!.arc(x, y, 2.1, 0, Math.PI * 2);
        ctx!.fillStyle = "#fff";
        ctx!.globalAlpha = 0.85;
        ctx!.fill();
        ctx!.globalAlpha = 1;
      }

      const hub = byId.get(hubId);
      if (hub) {
        const pulse = (Math.sin(time / 380) + 1) * 0.5;
        const active = (hoverRef.current ?? pickedRef.current) === hub.id;
        ctx!.beginPath();
        ctx!.arc(hub.x, hub.y, 28 + pulse * 10, 0, Math.PI * 2);
        ctx!.strokeStyle = `rgba(91,156,255,${0.12 + pulse * 0.14})`;
        ctx!.lineWidth = 1.2;
        ctx!.stroke();
        ctx!.beginPath();
        ctx!.arc(hub.x, hub.y, 40 + pulse * 5, 0, Math.PI * 2);
        ctx!.strokeStyle = `rgba(91,156,255,${0.05 + pulse * 0.06})`;
        ctx!.stroke();
        drawHex(ctx!, hub.x, hub.y, 16);
        ctx!.fillStyle = active ? "rgba(91,156,255,0.34)" : "rgba(91,156,255,0.2)";
        ctx!.fill();
        drawHex(ctx!, hub.x, hub.y, 16);
        ctx!.strokeStyle = active ? "#fff" : "#8ec0ff";
        ctx!.lineWidth = active ? 2.2 : 1.8;
        ctx!.stroke();
        ctx!.fillStyle = "#fff";
        ctx!.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "middle";
        ctx!.fillText("K", hub.x, hub.y + 0.5);
      }

      const focus = hoverRef.current ?? pickedRef.current;
      for (const n of nodes) {
        if (n.id === hubId) continue;
        n.x = n.homeX + Math.sin(time / 900 + n.phase) * 0.9;
        n.y = n.homeY + Math.cos(time / 1100 + n.phase) * 0.8;
        const c = ROLE_COLOR[n.role];
        const active = focus === n.id;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r + 5 + n.strength * 2, 0, Math.PI * 2);
        ctx!.fillStyle = c;
        ctx!.globalAlpha = active ? 0.32 : 0.1 + n.strength * 0.08;
        ctx!.fill();
        ctx!.globalAlpha = 1;

        if (active || n.strength > 0.55) {
          ctx!.strokeStyle = c;
          ctx!.globalAlpha = 0.35;
          ctx!.lineWidth = 0.8;
          for (let d = 0; d < 3; d++) {
            const ang = n.phase + (d * Math.PI * 2) / 3;
            ctx!.beginPath();
            ctx!.moveTo(n.x, n.y);
            ctx!.lineTo(n.x + Math.cos(ang) * (n.r + 8), n.y + Math.sin(ang) * (n.r + 8));
            ctx!.stroke();
          }
          ctx!.globalAlpha = 1;
        }

        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx!.fillStyle = c;
        ctx!.fill();
        ctx!.strokeStyle = "rgba(7,11,20,0.35)";
        ctx!.lineWidth = 1;
        ctx!.stroke();

        if (active) {
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, n.r + 6, 0, Math.PI * 2);
          ctx!.strokeStyle = "rgba(255,255,255,0.65)";
          ctx!.lineWidth = 1.3;
          ctx!.stroke();
        }

        if (active || n.r >= 6.5 || n.strength > 0.7) {
          ctx!.fillStyle = active ? "rgba(230,237,248,0.95)" : "rgba(230,237,248,0.72)";
          ctx!.font = "500 10.5px ui-sans-serif, system-ui, sans-serif";
          ctx!.textAlign = "center";
          ctx!.textBaseline = "top";
          ctx!.fillText(clipLabel(n.title), n.x, n.y + n.r + 4);
        }
      }

      raf = requestAnimationFrame(paint);
    }

    rebuild();
    spawnTimer = window.setInterval(spawnPulse, 320);
    raf = requestAnimationFrame(paint);
    const ro = new ResizeObserver(() => scheduleRebuild());
    ro.observe(wrap);
    window.addEventListener("resize", scheduleRebuild);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      window.clearInterval(spawnTimer);
      window.removeEventListener("resize", scheduleRebuild);
      ro.disconnect();
    };
  }, [hasData, props.graph]);

  const selectedViz = useMemo(() => {
    if (picked === KERNEL_ID) {
      return { id: KERNEL_ID, kind: "class" as const, title: "KERNEL", shelf: "internal" as const, role: "kernel" as const };
    }
    const node = props.graph.nodes.find((item) => item.id === picked);
    if (!node) return undefined;
    return { ...node, role: cortexRole(node, props.graph.edges) };
  }, [picked, props.graph]);

  const related = useMemo(() => {
    if (!picked) return [] as Array<{
      synapse: "recall" | "transfer" | "kernel";
      otherTitle: string;
      otherRole: CortexRole;
      otherId: string;
    }>;
    const rows: Array<{
      synapse: "recall" | "transfer" | "kernel";
      otherTitle: string;
      otherRole: CortexRole;
      otherId: string;
    }> = [];
    if (picked === KERNEL_ID) {
      for (const node of props.graph.nodes) {
        rows.push({
          synapse: "kernel",
          otherTitle: node.title,
          otherRole: cortexRole(node, props.graph.edges),
          otherId: node.id,
        });
      }
      return rows;
    }
    rows.push({
      synapse: "kernel",
      otherTitle: "KERNEL",
      otherRole: "kernel",
      otherId: KERNEL_ID,
    });
    for (const edge of props.graph.edges) {
      if (edge.src !== picked && edge.dst !== picked) continue;
      const otherId = edge.src === picked ? edge.dst : edge.src;
      const other = props.graph.nodes.find((node) => node.id === otherId);
      if (!other) continue;
      rows.push({
        synapse: synapseOf(edge.kind),
        otherTitle: other.title,
        otherRole: cortexRole(other, props.graph.edges),
        otherId: other.id,
      });
    }
    return rows;
  }, [picked, props.graph]);

  function hit(mx: number, my: number): VizNode | undefined {
    const frame = frameRef.current;
    if (!frame) return;
    for (let i = frame.nodes.length - 1; i >= 0; i--) {
      const n = frame.nodes[i];
      const r = n.id === KERNEL_ID ? 24 : n.r + 8;
      if ((mx - n.x) ** 2 + (my - n.y) ** 2 < r * r) return n;
    }
  }

  function roleLabel(role: CortexRole): string {
    if (role === "kernel") return props.roles.kernel;
    if (role === "shadow") return props.roles.shadow;
    if (role === "skill") return props.roles.skill;
    if (role === "verified") return props.roles.verified;
    return props.roles.episode;
  }

  function roleBody(role: CortexRole): string {
    if (role === "kernel") return props.labels.kernelRole;
    if (role === "shadow") return props.labels.shadowRole;
    if (role === "skill") return props.labels.skillRole;
    if (role === "verified") return props.labels.verifiedRole;
    return props.labels.episodeRole;
  }

  if (!hasData) {
    return <div className="muted">{props.empty}</div>;
  }

  const corticalCount = props.graph.nodes.length;
  const synapseCount = (frameRef.current?.edges.length ?? props.graph.edges.length);

  return (
    <div className="graph-wrap">
      <div className="graph-summary">
        <div>
          <strong>{props.labels.overview}</strong>
          <span>{props.labels.selectHint}</span>
        </div>
        <div className="graph-stats">
          <span><b>{corticalCount}</b>{props.labels.nodes}</span>
          <span><b>{Math.max(synapseCount, props.graph.edges.length)}</b>{props.labels.connections}</span>
          <span><b>{pulseCount}</b>{props.labels.pulses}</span>
        </div>
      </div>
      <div className="graph-workspace">
        <div className="graph-canvas brain-canvas" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="graph-brain"
            role="img"
            aria-label="experience brain synapses"
            onMouseMove={(event) => {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (!rect) return;
              const n = hit(event.clientX - rect.left, event.clientY - rect.top);
              setHover(n?.id);
              if (canvasRef.current) canvasRef.current.style.cursor = n ? "pointer" : "default";
            }}
            onMouseLeave={() => setHover(undefined)}
            onClick={(event) => {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (!rect) return;
              const n = hit(event.clientX - rect.left, event.clientY - rect.top);
              setPicked(n?.id);
            }}
          />
          <div className="graph-canvas-legend">
            <span><i className="swatch shadow" />{props.roles.shadow}</span>
            <span><i className="swatch skill" />{props.roles.skill}</span>
            <span><i className="swatch verified" />{props.roles.verified}</span>
            <span><i className="swatch episode" />{props.roles.episode}</span>
            <span><i className="swatch kernel" />{props.roles.kernel}</span>
            <span>{props.labels.edgeLegend}</span>
          </div>
        </div>
        <aside className="graph-inspector">
          {selectedViz ? (
            <>
              <span className={`graph-kind ${selectedViz.role}`}>{roleLabel(selectedViz.role)}</span>
              <h3>{selectedViz.role === "kernel" ? props.roles.kernel : selectedViz.title}</h3>
              {selectedViz.role !== "kernel" ? <code>{selectedViz.id}</code> : null}
              <div className="graph-role-block">
                <label>{props.labels.roleTitle}</label>
                <p>{roleBody(selectedViz.role)}</p>
              </div>
              <h4>{props.labels.connectedTo} <span>{related.length}</span></h4>
              <div className="graph-relations">
                {related.length ? related.map((row) => (
                  <button
                    type="button"
                    key={`${picked}-${row.otherId}-${row.synapse}`}
                    onClick={() => setPicked(row.otherId)}
                  >
                    <i className={`swatch ${row.otherRole}`} />
                    <span>
                      <strong>{row.otherTitle}</strong>
                      <small>{row.synapse === "recall" ? props.edgeKinds.recall : row.synapse === "kernel" ? props.roles.kernel : props.edgeKinds.transfer}</small>
                    </span>
                  </button>
                )) : <p>{props.labels.noConnections}</p>}
              </div>
              {selectedViz.role !== "kernel" && selectedViz.kind !== "class" ? (
                <button className="secondary-button graph-open" type="button" onClick={() => props.onSelect(selectedViz.id)}>
                  {props.labels.openDetails}
                </button>
              ) : null}
            </>
          ) : (
            <div className="graph-inspector-empty">{props.labels.selectHint}</div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Map experience nodes onto Self cortex roles. */
export function cortexRole(node: ExperienceNode, edges: ExperienceEdge[] = []): CortexRole {
  if (node.kind === "rule" || node.kind === "class") return "shadow";
  if (node.kind === "note") return "episode";
  if (node.id.startsWith("backlog/")) return "skill";
  const transferred = edges.some(
    (edge) => edge.kind === "recovered-by" && (edge.src === node.id || edge.dst === node.id),
  );
  if (transferred || node.id.startsWith("plugin/")) return "verified";
  return "skill";
}

export function synapseOf(kind: ExperienceEdge["kind"]): "recall" | "transfer" {
  return kind === "failed-as" ? "recall" : "transfer";
}

/** Kernel always at the stem; cortical traces only inside the brain mask. */
export function layoutBrain(graph: GraphData, width = 900, height = 560): Frame {
  const CX = width * 0.5;
  const CY = height * 0.48;
  const SX = Math.min(width, height * 1.15) * 0.78;
  const SY = Math.min(width, height) * 0.78;
  const deg = degreeMap(graph);

  const kernel: VizNode = {
    id: KERNEL_ID,
    kind: "class",
    title: "KERNEL",
    shelf: "internal",
    role: "kernel",
    x: CX,
    y: CY + SY * 0.04,
    homeX: CX,
    homeY: CY + SY * 0.04,
    r: 16,
    phase: 0,
    strength: 1,
  };

  const placed: VizNode[] = [kernel];
  const order = [...graph.nodes].sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0));
  const minGap = order.length > 14 ? 22 : order.length > 8 ? 26 : 30;

  for (let index = 0; index < order.length; index++) {
    const node = order[index];
    const role = cortexRole(node, graph.edges);
    const preferLeft = role === "shadow";
    const preferRight = role === "skill" || role === "verified";
    const side = preferLeft ? -1 : preferRight ? 1 : hashId(node.id) % 2 === 0 ? -1 : 1;
    let x = CX + side * SX * 0.18;
    let y = CY;
    let ok = false;

    for (let attempt = 0; attempt < 220; attempt++) {
      const seed = hashId(`${node.id}:${attempt}:${index}`);
      const ring = 0.13 + (attempt % 10) * 0.026 + ((seed % 17) / 17) * 0.018;
      const spread = Math.PI * 0.7;
      const base = side < 0 ? Math.PI : 0;
      const ang = base + (((seed % 997) / 997) - 0.5) * spread + attempt * 0.41;
      x = CX + Math.cos(ang) * ring * SX;
      y = CY + Math.sin(ang) * ring * SY * 0.9 - SY * 0.02;
      if (preferLeft && x >= CX - 4) continue;
      if (preferRight && x <= CX + 4) continue;
      if (!pointInBrain(x, y, CX, CY, SX, SY)) continue;
      if (Math.hypot(x - kernel.x, y - kernel.y) < 52) continue;
      let clear = true;
      for (const other of placed) {
        if (Math.hypot(x - other.x, y - other.y) < minGap) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      ok = true;
      break;
    }

    if (!ok) {
      for (let step = 0; step < 28; step++) {
        const t = 0.36 - step * 0.01;
        const ang = index * 2.15 + step * 0.55;
        x = CX + side * Math.abs(Math.cos(ang)) * SX * Math.max(0.1, t);
        y = CY + Math.sin(ang) * SY * Math.max(0.1, t) * 0.8 - SY * 0.02;
        const pulled = pullInsideBrain(x, y, CX, CY, SX, SY, kernel.x, kernel.y);
        x = pulled.x;
        y = pulled.y;
        if (!pointInBrain(x, y, CX, CY, SX, SY)) continue;
        if (Math.hypot(x - kernel.x, y - kernel.y) < 40) continue;
        let clear = true;
        for (const other of placed) {
          if (Math.hypot(x - other.x, y - other.y) < minGap * 0.72) {
            clear = false;
            break;
          }
        }
        if (clear) {
          ok = true;
          break;
        }
      }
    }

    {
      const pulled = pullInsideBrain(
        ok ? x : CX + side * SX * 0.18,
        ok ? y : CY - SY * 0.06 + (index % 5) * 8,
        CX,
        CY,
        SX,
        SY,
        kernel.x,
        kernel.y,
      );
      x = pulled.x;
      y = pulled.y;
    }

    const degree = deg.get(node.id) ?? 0;
    const r = role === "episode" ? 5 : role === "verified" ? 7.2 : role === "skill" ? 6.8 : 6.2;
    placed.push({
      ...node,
      role,
      x,
      y,
      homeX: x,
      homeY: y,
      r: r + Math.min(2.2, degree * 0.3),
      phase: (hashId(node.id) % 628) / 100,
      strength: Math.min(1, 0.35 + degree * 0.12),
    });
  }

  const realEdges: VizEdge[] = graph.edges.map((edge) => ({
    src: edge.src,
    dst: edge.dst,
    synapse: synapseOf(edge.kind),
    labelKind: edge.kind,
  }));
  const spokes: VizEdge[] = order.map((node) => ({
    src: KERNEL_ID,
    dst: node.id,
    synapse: "kernel" as const,
    spoke: true,
  }));

  const byId = new Map(placed.map((node) => [node.id, node]));
  return {
    W: width,
    H: height,
    CX,
    CY,
    SX,
    SY,
    hubId: KERNEL_ID,
    nodes: placed,
    byId,
    edges: [...spokes, ...realEdges],
  };
}

export function layoutForce(graph: GraphData, width = 900, height = 640) {
  const frame = layoutBrain(graph, width, height);
  return {
    width: frame.W,
    height: frame.H,
    originX: 0,
    originY: 0,
    nodes: frame.nodes.filter((n) => n.id !== KERNEL_ID),
    edges: graph.edges,
  };
}

function degreeMap(graph: GraphData): Map<string, number> {
  const deg = new Map<string, number>();
  for (const node of graph.nodes) deg.set(node.id, 0);
  for (const edge of graph.edges) {
    deg.set(edge.src, (deg.get(edge.src) ?? 0) + 1);
    deg.set(edge.dst, (deg.get(edge.dst) ?? 0) + 1);
  }
  return deg;
}

function hemispherePath(sideSign: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [
    [0.02, -0.52],
    [0.18, -0.55], [0.34, -0.48], [0.42, -0.32],
    [0.48, -0.12], [0.50, 0.08], [0.46, 0.26],
    [0.42, 0.40], [0.34, 0.50], [0.20, 0.54],
    [0.08, 0.50], [0.02, 0.38], [0.00, 0.18],
    [0.00, -0.05], [0.00, -0.28], [0.02, -0.52],
  ];
  return pts.map(([x, y]) => [x * sideSign, y]);
}

function drawHemisphere(
  ctx: CanvasRenderingContext2D,
  sideSign: number,
  cx: number,
  cy: number,
  sx: number,
  sy: number,
  fill: boolean,
) {
  const pts = hemispherePath(sideSign);
  ctx.beginPath();
  ctx.moveTo(cx + pts[0][0] * sx, cy + pts[0][1] * sy);
  for (let i = 1; i < pts.length - 2; i += 3) {
    ctx.bezierCurveTo(
      cx + pts[i][0] * sx,
      cy + pts[i][1] * sy,
      cx + pts[i + 1][0] * sx,
      cy + pts[i + 1][1] * sy,
      cx + pts[i + 2][0] * sx,
      cy + pts[i + 2][1] * sy,
    );
  }
  if (fill) ctx.fill();
  else ctx.stroke();
}

export function pointInBrain(x: number, y: number, cx: number, cy: number, sx: number, sy: number): boolean {
  const inset = 0.86;
  const nx = (x - cx) / (sx * inset);
  const ny = (y - cy) / (sy * inset);
  const left = ((nx + 0.2) / 0.3) ** 2 + (ny / 0.46) ** 2 <= 1;
  const right = ((nx - 0.2) / 0.3) ** 2 + (ny / 0.46) ** 2 <= 1;
  const frontal = (nx / 0.22) ** 2 + ((ny + 0.22) / 0.22) ** 2 <= 1;
  return left || right || frontal;
}

function pullInsideBrain(
  x: number,
  y: number,
  cx: number,
  cy: number,
  sx: number,
  sy: number,
  towardX: number,
  towardY: number,
): { x: number; y: number } {
  if (pointInBrain(x, y, cx, cy, sx, sy)) return { x, y };
  let px = x;
  let py = y;
  for (let i = 0; i < 18; i++) {
    px = towardX + (px - towardX) * 0.7;
    py = towardY + (py - towardY) * 0.7;
    if (pointInBrain(px, py, cx, cy, sx, sy)) return { x: px, y: py };
  }
  const side = x < towardX ? -1 : 1;
  return { x: towardX + side * sx * 0.16, y: towardY - sy * 0.05 };
}

function drawSulci(ctx: CanvasRenderingContext2D, CX: number, CY: number, SX: number, SY: number) {
  ctx.save();
  ctx.strokeStyle = "rgba(120,160,220,0.08)";
  ctx.lineWidth = 1;
  const folds = [
    [[-0.35, -0.25], [-0.18, -0.08], [-0.32, 0.12]],
    [[-0.28, 0.05], [-0.12, 0.22], [-0.26, 0.38]],
    [[0.35, -0.25], [0.18, -0.08], [0.32, 0.12]],
    [[0.28, 0.05], [0.12, 0.22], [0.26, 0.38]],
    [[-0.15, -0.42], [0, -0.36], [0.15, -0.42]],
  ] as const;
  for (const f of folds) {
    ctx.beginPath();
    ctx.moveTo(CX + f[0][0] * SX, CY + f[0][1] * SY);
    ctx.quadraticCurveTo(CX + f[1][0] * SX, CY + f[1][1] * SY, CX + f[2][0] * SX, CY + f[2][1] * SY);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBrain(ctx: CanvasRenderingContext2D, CX: number, CY: number, SX: number, SY: number) {
  ctx.save();
  ctx.shadowColor = "rgba(91,156,255,0.35)";
  ctx.shadowBlur = 28;
  ctx.strokeStyle = "rgba(120,170,255,0.28)";
  ctx.lineWidth = 2.2;
  drawHemisphere(ctx, -1, CX, CY, SX, SY, false);
  drawHemisphere(ctx, 1, CX, CY, SX, SY, false);
  ctx.shadowBlur = 0;

  const g = ctx.createRadialGradient(CX, CY, 10, CX, CY, SX * 0.5);
  g.addColorStop(0, "rgba(91,156,255,0.07)");
  g.addColorStop(0.55, "rgba(40,70,120,0.04)");
  g.addColorStop(1, "rgba(7,11,20,0)");
  ctx.fillStyle = g;
  drawHemisphere(ctx, -1, CX, CY, SX * 0.99, SY * 0.99, true);
  drawHemisphere(ctx, 1, CX, CY, SX * 0.99, SY * 0.99, true);

  ctx.strokeStyle = "rgba(150,190,255,0.14)";
  ctx.lineWidth = 1;
  drawHemisphere(ctx, -1, CX, CY, SX * 0.94, SY * 0.94, false);
  drawHemisphere(ctx, 1, CX, CY, SX * 0.94, SY * 0.94, false);

  ctx.beginPath();
  ctx.moveTo(CX, CY - SY * 0.5);
  ctx.bezierCurveTo(CX + 3, CY - SY * 0.15, CX - 3, CY + SY * 0.2, CX, CY + SY * 0.52);
  ctx.strokeStyle = "rgba(140,180,255,0.16)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(CX - 10, CY + SY * 0.12);
  ctx.quadraticCurveTo(CX, CY + SY * 0.28, CX + 10, CY + SY * 0.12);
  ctx.strokeStyle = "rgba(200,210,230,0.12)";
  ctx.stroke();

  drawSulci(ctx, CX, CY, SX, SY);
  ctx.restore();
}

function drawHex(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.closePath();
}

function edgeCurve(a: { x: number; y: number }, b: { x: number; y: number }) {
  return {
    mx: (a.x + b.x) / 2 + (a.y - b.y) * 0.08,
    my: (a.y + b.y) / 2 + (b.x - a.x) * 0.08,
  };
}

function hashId(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function clipLabel(title: string): string {
  const text = title.replace(/\s+/g, " ").trim();
  return text.length > 22 ? `${text.slice(0, 21)}…` : text;
}
