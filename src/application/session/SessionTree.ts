/**
 * Session tree — alternate branches without erasing prior work (JSONL parentId).
 * Stored alongside the run; active branch owns the live transcript view.
 */

import { event, type DomainEvent } from "../../domain/shared/DomainEvent.ts";
import type { TranscriptItem } from "../../domain/run/Run.ts";

export type SessionBranch = {
  id: string;
  parentId?: string;
  title: string;
  createdAt: string;
  /** Snapshot of transcript at fork / last sync. */
  transcript: TranscriptItem[];
  summary?: string;
};

export type SessionTreeState = {
  activeId: string;
  branches: SessionBranch[];
};

export function emptyTree(rootTranscript: TranscriptItem[], title = "main"): SessionTreeState {
  const id = crypto.randomUUID();
  return {
    activeId: id,
    branches: [{
      id,
      title,
      createdAt: new Date().toISOString(),
      transcript: [...rootTranscript],
    }],
  };
}

export function forkBranch(
  tree: SessionTreeState,
  fromTranscript: TranscriptItem[],
  title?: string,
): { tree: SessionTreeState; events: DomainEvent[]; branchId: string } {
  const parent = tree.branches.find((b) => b.id === tree.activeId);
  const id = crypto.randomUUID();
  const branch: SessionBranch = {
    id,
    parentId: tree.activeId,
    title: title?.trim() || `fork ${new Date().toISOString().slice(11, 19)}`,
    createdAt: new Date().toISOString(),
    transcript: [...fromTranscript],
    summary: parent?.summary,
  };
  const next: SessionTreeState = {
    activeId: id,
    branches: [...tree.branches.map((b) =>
      b.id === tree.activeId ? { ...b, transcript: [...fromTranscript] } : b,
    ), branch],
  };
  return {
    tree: next,
    branchId: id,
    events: [event("run.branch_forked", { branchId: id, parentId: tree.activeId, title: branch.title })],
  };
}

export function switchBranch(
  tree: SessionTreeState,
  branchId: string,
  currentTranscript: TranscriptItem[],
  abandonedSummary?: string,
): { tree: SessionTreeState; events: DomainEvent[]; transcript: TranscriptItem[] } {
  const target = tree.branches.find((b) => b.id === branchId);
  if (!target) throw new Error(`branch not found: ${branchId}`);
  const branches = tree.branches.map((b) => {
    if (b.id === tree.activeId) {
      return {
        ...b,
        transcript: [...currentTranscript],
        ...(abandonedSummary ? { summary: abandonedSummary } : {}),
      };
    }
    return b;
  });
  const next: SessionTreeState = { activeId: branchId, branches };
  return {
    tree: next,
    transcript: [...target.transcript],
    events: [event("run.branch_switched", {
      branchId,
      fromId: tree.activeId,
      abandonedSummary: abandonedSummary ?? null,
    })],
  };
}

export function listBranches(tree: SessionTreeState): Array<{ id: string; title: string; parentId?: string; active: boolean }> {
  return tree.branches.map((b) => ({
    id: b.id,
    title: b.title,
    parentId: b.parentId,
    active: b.id === tree.activeId,
  }));
}
