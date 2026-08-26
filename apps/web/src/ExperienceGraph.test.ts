import { expect, test } from "bun:test";
import { layoutForce } from "./ExperienceGraph.tsx";
import type { ExperienceGraph } from "./types.ts";

test("force layout places every node on a finite canvas", () => {
  const graph: ExperienceGraph = {
    nodes: [
      { id: "class:fs", kind: "class", title: "fs", shelf: "learned" },
      { id: "rule:1", kind: "rule", title: "retry once", shelf: "learned" },
      { id: "skill:write", kind: "plugin", title: "write", shelf: "learned" },
      { id: "note:a", kind: "note", title: "operator note", shelf: "yours" },
    ],
    edges: [
      { src: "class:fs", dst: "rule:1", kind: "failed-as", createdAt: "" },
      { src: "rule:1", dst: "skill:write", kind: "learned", createdAt: "" },
      { src: "skill:write", dst: "class:fs", kind: "recovered-by", createdAt: "" },
    ],
  };
  const laid = layoutForce(graph);
  expect(laid.nodes).toHaveLength(4);
  expect(laid.width).toBeGreaterThan(80);
  expect(laid.height).toBeGreaterThan(80);
  for (const node of laid.nodes) {
    expect(Number.isFinite(node.x)).toBe(true);
    expect(Number.isFinite(node.y)).toBe(true);
    expect(node.r).toBeGreaterThan(2);
  }
  const xs = laid.nodes.map((node) => node.x);
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(8);
});
