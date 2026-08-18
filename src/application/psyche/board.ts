export const BOARD_KINDS = ["motive", "action", "operation", "fact", "blocker", "decision", "note"] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];
const LOCKED = new Set<BoardKind>(["motive"]);
const SINGLE = new Set<BoardKind>(["motive", "action", "operation"]);

export type BoardEntry = {
  kind: BoardKind;
  text: string;
};

export const BOARD_CAP = 16;

export function parseBoard(body: string): BoardEntry[] {
  const entries: BoardEntry[] = [];
  for (const line of body.split("\n")) {
    const match = line.match(/^-\s*\[(\w+)\]\s*(.+)$/);
    if (!match) continue;
    const kind = match[1] as BoardKind;
    if (!BOARD_KINDS.includes(kind)) continue;
    entries.push({ kind, text: (match[2] ?? "").trim() });
  }
  return entries.slice(-BOARD_CAP);
}

export function addBoard(entries: BoardEntry[], next: BoardEntry): BoardEntry[] {
  const text = next.text.replace(/\s+/g, " ").trim();
  if (!text) return entries;
  if (LOCKED.has(next.kind)) {
    const current = entries.find((item) => item.kind === "motive");
    if (current) return entries;
  }
  if (entries.some((item) => item.kind === next.kind && item.text === text)) return entries;
  const base = SINGLE.has(next.kind) ? entries.filter((item) => item.kind !== next.kind) : entries;
  return [...base, { kind: next.kind, text }].slice(-BOARD_CAP);
}

export function refuseMotiveChange(entries: BoardEntry[], next: BoardEntry): string | null {
  if (next.kind !== "motive") return null;
  const current = entries.find((item) => item.kind === "motive");
  if (!current) return null;
  const incoming = next.text.replace(/\s+/g, " ").trim();
  if (current.text === incoming) return null;
  return "error: the session motive is set by the operator. It cannot change without a new goal.";
}

export function formatBoard(entries: BoardEntry[]): string {
  if (!entries.length) return "# Board\n(empty)";
  return ["# Board", ...entries.map((item) => `- [${item.kind}] ${item.text}`)].join("\n");
}

export function renderBoardPrompt(entries: BoardEntry[]): string {
  if (!entries.length) return "";
  const motive = entries.find((item) => item.kind === "motive");
  const action = entries.find((item) => item.kind === "action");
  const operation = entries.find((item) => item.kind === "operation");
  const rest = entries.filter((item) => !SINGLE.has(item.kind)).slice(-8);
  return [
    "Board (Leontiev): session motive ≠ turn action ≠ tool operation. Do not change the motive without the operator.",
    motive ? `Motive: ${motive.text}` : "",
    action ? `Action: ${action.text}` : "",
    operation ? `Operation: ${operation.text}` : "",
    rest.length ? rest.map((item) => `- [${item.kind}] ${item.text}`).join("\n") : "",
  ].filter(Boolean).join("\n");
}

export function isBoardKind(value: string): value is BoardKind {
  return BOARD_KINDS.includes(value as BoardKind);
}
