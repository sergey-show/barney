/**
 * Turn-0 checklist (GUARD-style): compile atomic binary checks before the first
 * tool call; grade them after the turn against evidence — not against vibe.
 */

export type ChecklistKind = "artifact" | "action" | "constraint" | "verify";

export type ChecklistItem = {
  id: string;
  kind: ChecklistKind;
  text: string;
};

export type ChecklistGrade = {
  id: string;
  ok: boolean;
  detail: string;
};

export type ChecklistReport = {
  items: ChecklistItem[];
  grades: ChecklistGrade[];
  passed: number;
  failed: number;
  line: string;
};

/** Build a short Turn-0 checklist from the goal (and optional anchors). */
export function compileTurnChecklist(input: {
  goal: string;
  anchors?: string[];
  maxItems?: number;
}): ChecklistItem[] {
  const goal = input.goal.replace(/\s+/g, " ").trim();
  const max = input.maxItems ?? 6;
  const items: ChecklistItem[] = [];
  const push = (kind: ChecklistKind, text: string) => {
    if (items.length >= max) return;
    const id = `${kind}-${items.length + 1}`;
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return;
    if (items.some((row) => row.text === normalized)) return;
    items.push({ id, kind, text: normalized.slice(0, 140) });
  };

  const paths = extractLikelyPaths(goal);
  for (const path of paths.slice(0, 3)) {
    push("artifact", `deliver or update path: ${path}`);
  }

  if (/\b(test|pytest|verify|check|lint|typecheck|build)\b/i.test(goal)) {
    push("verify", "run a concrete verification command and keep its output");
  }
  if (/\b(secret|redact|sanitize|token|password|api[_-]?key)\b/i.test(goal)) {
    push("constraint", "no live secrets left in written files");
    push("verify", "tree-check that secret masks are gone");
  }
  if (/\b(merge|canonical|json|yaml)\b/i.test(goal)) {
    push("constraint", "output matches the stated format/canon exactly");
  }
  if (/\b(only|do not|don't|without|must not)\b/i.test(goal)) {
    push("constraint", "honor explicit do-not / only constraints from the goal");
  }
  if (/\b(commit|push|delete|rm\b|drop|destroy)\b/i.test(goal)) {
    push("action", "destructive steps only after explicit allow");
  }

  for (const anchor of input.anchors ?? []) {
    const clipped = anchor.replace(/\s+/g, " ").trim().slice(0, 100);
    if (clipped) push("constraint", `respect anchor: ${clipped}`);
  }

  if (!items.length) {
    push("artifact", "produce a checkable artifact or command result for the goal");
    push("verify", "confirm the artifact exists before claiming done");
  } else if (!items.some((row) => row.kind === "verify")) {
    push("verify", "confirm deliverables against the goal before done");
  }

  return items.slice(0, max);
}

export function formatChecklistPrompt(items: ChecklistItem[]): string {
  if (!items.length) return "";
  const lines = items.map((item, i) => `${i + 1}. [${item.kind}] ${item.text}`);
  return [
    "TURN-0 CHECKLIST (satisfy each item; do not claim done with any open):",
    ...lines,
  ].join("\n");
}

export function gradeTurnChecklist(input: {
  items: ChecklistItem[];
  goal: string;
  evidence: string;
  reply?: string;
  reviewMissing?: string;
}): ChecklistReport {
  const evidence = `${input.evidence}\n${input.reply ?? ""}`;
  const missing = (input.reviewMissing ?? "").toLowerCase();
  const grades: ChecklistGrade[] = input.items.map((item) => {
    if (item.kind === "artifact") {
      const path = item.text.replace(/^deliver or update path:\s*/i, "").trim();
      const ok = path
        ? evidenceIncludesPath(evidence, path) || /wrote|created|saved|updated/i.test(evidence)
        : /wrote|created|saved|updated|artifact/i.test(evidence);
      return {
        id: item.id,
        ok,
        detail: ok ? "artifact signal present" : "no artifact evidence",
      };
    }
    if (item.kind === "verify") {
      const ok = /exit\s*0|passed|ok\b|verified|grep|test|typecheck|lint/i.test(evidence)
        && !/not yet written|missing|failed/i.test(missing);
      return {
        id: item.id,
        ok,
        detail: ok ? "verify signal present" : "verification weak or missing",
      };
    }
    if (item.kind === "constraint") {
      if (/secret/i.test(item.text)) {
        const ok = !/AKIA[0-9A-Z]{8,}|ghp_[A-Za-z0-9]{8,}|xoxb-/i.test(evidence);
        return { id: item.id, ok, detail: ok ? "no live secret pattern" : "live secret pattern in evidence" };
      }
      const ok = !missing || !/constraint|only change|do not/i.test(missing);
      return {
        id: item.id,
        ok,
        detail: ok ? "constraint not flagged missing" : "review flagged a constraint miss",
      };
    }
    // action
    const ok = !/needs.?user|awaiting approval|denied/i.test(evidence + missing)
      || /approved|allow/i.test(evidence);
    return {
      id: item.id,
      ok,
      detail: ok ? "action path clear" : "action blocked or unresolved",
    };
  });
  const passed = grades.filter((g) => g.ok).length;
  const failed = grades.length - passed;
  const line =
    `turn_checklist: ${passed}/${grades.length} pass`
    + (failed
      ? ` · fail=${grades.filter((g) => !g.ok).map((g) => g.id).join(",")}`
      : " · all clear");
  return { items: input.items, grades, passed, failed, line };
}

function extractLikelyPaths(goal: string): string[] {
  const found: string[] = [];
  const re = /(?:^|[\s`'"(])((?:\.\/)?[\w.-]+(?:\/[\w.-]+)+|(?:[\w.-]+\.(?:json|ya?ml|toml|txt|md|env|py|ts|js|mjs|c|h|sh)))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(goal))) {
    const path = match[1];
    if (path && !found.includes(path)) found.push(path);
  }
  return found;
}

function evidenceIncludesPath(evidence: string, path: string): boolean {
  const base = path.split("/").pop() ?? path;
  return evidence.includes(path) || (base.length > 2 && evidence.includes(base));
}
