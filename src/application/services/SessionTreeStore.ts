/**
 * Persist session trees under sessionPath/.barney/tree.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TranscriptItem } from "../../domain/run/Run.ts";
import {
  emptyTree,
  forkBranch,
  listBranches,
  switchBranch,
  type SessionTreeState,
} from "../session/SessionTree.ts";

export class SessionTreeStore {
  private readonly mem = new Map<string, SessionTreeState>();

  load(runId: string, sessionPath: string, transcript: TranscriptItem[]): SessionTreeState {
    const cached = this.mem.get(runId);
    if (cached) return cached;
    const path = treePath(sessionPath);
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as SessionTreeState;
        if (parsed?.activeId && Array.isArray(parsed.branches)) {
          this.mem.set(runId, parsed);
          return parsed;
        }
      } catch {
        /* fall through */
      }
    }
    const tree = emptyTree(transcript);
    this.mem.set(runId, tree);
    this.save(runId, sessionPath, tree);
    return tree;
  }

  save(runId: string, sessionPath: string, tree: SessionTreeState): void {
    this.mem.set(runId, tree);
    const path = treePath(sessionPath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(tree, null, 2), "utf8");
  }

  fork(runId: string, sessionPath: string, transcript: TranscriptItem[], title?: string) {
    const tree = this.load(runId, sessionPath, transcript);
    const result = forkBranch(tree, transcript, title);
    this.save(runId, sessionPath, result.tree);
    return result;
  }

  switchTo(
    runId: string,
    sessionPath: string,
    transcript: TranscriptItem[],
    branchId: string,
    abandonedSummary?: string,
  ) {
    const tree = this.load(runId, sessionPath, transcript);
    const result = switchBranch(tree, branchId, transcript, abandonedSummary);
    this.save(runId, sessionPath, result.tree);
    return result;
  }

  list(runId: string, sessionPath: string, transcript: TranscriptItem[]) {
    return listBranches(this.load(runId, sessionPath, transcript));
  }
}

function treePath(sessionPath: string): string {
  return join(sessionPath, ".barney", "tree.json");
}
