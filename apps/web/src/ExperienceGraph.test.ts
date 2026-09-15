import { expect, test } from "bun:test";
import { cortexRole, KERNEL_ID, layoutBrain, layoutForce, pointInBrain, synapseOf } from "./ExperienceGraph.tsx";
import type { ExperienceGraph } from "./types.ts";

const graph: ExperienceGraph = {
  nodes: [
    { id: "class/general", kind: "class", title: "general", shelf: "learned" },
    { id: "rule/1", kind: "rule", title: "retry once", shelf: "learned" },
    { id: "plugin/write", kind: "plugin", title: "write", shelf: "learned" },
    { id: "backlog/try", kind: "plugin", title: "try", shelf: "learned" },
    { id: "note/a", kind: "note", title: "operator note", shelf: "yours" },
  ],
  edges: [
    { src: "class/general", dst: "rule/1", kind: "failed-as", createdAt: "" },
    { src: "rule/1", dst: "plugin/write", kind: "learned", createdAt: "" },
    { src: "plugin/write", dst: "class/general", kind: "recovered-by", createdAt: "" },
  ],
};

test("kernel sits in the stem; general is a cortical shadow", () => {
  const laid = layoutBrain(graph, 900, 560);
  expect(laid.hubId).toBe(KERNEL_ID);
  const kernel = laid.byId.get(KERNEL_ID);
  const general = laid.byId.get("class/general");
  expect(kernel).toBeDefined();
  expect(Math.abs(kernel!.x - laid.CX)).toBeLessThan(2);
  expect(general?.role).toBe("shadow");
  expect(general!.x).not.toBe(kernel!.x);
});

test("roles and synapse kinds follow the reference metaphor", () => {
  expect(cortexRole(graph.nodes[0]!)).toBe("shadow");
  expect(cortexRole(graph.nodes[2]!, graph.edges)).toBe("verified");
  expect(cortexRole(graph.nodes[3]!)).toBe("skill");
  expect(cortexRole(graph.nodes[4]!)).toBe("episode");
  expect(synapseOf("failed-as")).toBe("recall");
  expect(synapseOf("learned")).toBe("transfer");
});

test("shadow biases left and skills right; all stay inside the brain", () => {
  const laid = layoutBrain(graph, 900, 560);
  expect(laid.byId.get("rule/1")!.x).toBeLessThan(laid.CX);
  expect(laid.byId.get("plugin/write")!.x).toBeGreaterThan(laid.CX);
  for (const node of laid.nodes) {
    if (node.id === KERNEL_ID) continue;
    expect(pointInBrain(node.x, node.y, laid.CX, laid.CY, laid.SX, laid.SY)).toBe(true);
  }
});

test("layoutForce omits the synthetic kernel hub", () => {
  const laid = layoutForce(graph);
  expect(laid.nodes.every((n) => n.id !== KERNEL_ID)).toBe(true);
  expect(laid.nodes).toHaveLength(5);
});
