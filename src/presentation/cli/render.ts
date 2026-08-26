import type { TranscriptItem } from "../../domain/run/Run.ts";
import { formatReplyFootnote } from "../../domain/run/replyMeta.ts";
import { visibleAssistantText } from "../../infrastructure/llm/visibleReply.ts";

const CHAT = new Set(["user", "assistant"]);

export const HUD = {
  text: "#f8f4ea",
  muted: "#b8a88a",
  accent: "#e8b86d",
  think: "#f0d78c",
  thinkDim: "#c4a46a",
  cons: "#d4c4a0",
  consDim: "#a8946c",
  review: "#f0d78c",
  research: "#c9b07a",
  line: "#3d3420",
  error: "#ef4444",
};

const colorEnabled = process.stdout.isTTY !== false && !process.env.NO_COLOR;

function hex(value: string): string {
  const n = value.replace("#", "");
  return `${parseInt(n.slice(0, 2), 16)};${parseInt(n.slice(2, 4), 16)};${parseInt(n.slice(4, 6), 16)}`;
}

function paint(color: string, text: string): string {
  if (!colorEnabled) return text;
  return `\x1b[38;2;${hex(color)}m${text}\x1b[0m`;
}

function bold(text: string): string {
  if (!colorEnabled) return text;
  return `\x1b[1m${text}\x1b[0m`;
}

function dim(text: string): string {
  if (!colorEnabled) return text;
  return `\x1b[2m${text}\x1b[0m`;
}

export const ansi = {
  text: (s: string) => paint(HUD.text, s),
  muted: (s: string) => paint(HUD.muted, s),
  accent: (s: string) => paint(HUD.accent, s),
  think: (s: string) => paint(HUD.think, s),
  thinkDim: (s: string) => paint(HUD.thinkDim, s),
  cons: (s: string) => paint(HUD.cons, s),
  consDim: (s: string) => paint(HUD.consDim, s),
  review: (s: string) => paint(HUD.review, s),
  research: (s: string) => paint(HUD.research, s),
  line: (s: string) => paint(HUD.line, s),
  error: (s: string) => paint(HUD.error, s),
  bold,
  dim,
};

export function cols(): number {
  return Math.max(48, Math.min(process.stdout.columns ?? 80, 88));
}

const LOGO_ORANGE = "#f06c2e";
const LOGO_WHITE = "#e6ebfc";

/** 3-line wordmark; first cell is the orange B. */
export const LOGO_ROWS = [
  [" █▀▀▄ ", " ▄▀▀▄ ", " ██▀▄ ", " █▄  █ ", " █▀▀▀ ", " █  █ "],
  [" █▀▀▄ ", " █▀▀█ ", " █▄▀  ", " █ █ █ ", " █▀▀  ", " ▀▄▄▀ "],
  [" █▄▄▀ ", " █  █ ", " █ ▀▄ ", " █  ▀█ ", " █▄▄▄ ", "  ██  "],
] as const;

export function logoLines(): string[] {
  if ((process.stdout.columns ?? 80) < 40) return [paint(LOGO_ORANGE, "Barney")];
  const colors = [LOGO_ORANGE, LOGO_WHITE, LOGO_WHITE, LOGO_WHITE, LOGO_WHITE, LOGO_WHITE];
  return LOGO_ROWS.map((row) => row.map((cell, i) => paint(colors[i] ?? LOGO_WHITE, cell)).join(""));
}

export function printBanner(agent: string, model?: string): void {
  const width = Math.min(cols(), 56);
  console.log();
  for (const row of logoLines()) console.log(row);
  console.log();
  console.log(ansi.muted(`   ${agent}${model ? ` · ${model}` : ""}`));
  console.log(ansi.muted("   /work  /debug  /memory  /agents  /sessions  /form  /quit"));
  console.log(ansi.line(`╭${"─".repeat(width - 2)}╮`));
  console.log();
}

export function printPrompt(): void {
  process.stdout.write(ansi.accent("▸ "));
}

export function printKind(kind: string): void {
  console.log(ansi.muted(kind.toUpperCase()));
}

export function printMeta(label: string, value: string): void {
  console.log(`${ansi.muted(label.padEnd(10))} ${ansi.text(value)}`);
}

export function printStatus(status: string, attempts?: number): void {
  const extra = attempts != null ? ` · ${attempts} attempt${attempts === 1 ? "" : "s"}` : "";
  const line = `${status}${extra}`;
  console.log(status === "failed" ? ansi.error(line) : ansi.muted(line));
  console.log();
}

export function printError(message: string): void {
  console.error(ansi.error(message));
}

export function printSection(title: string, rows: string[]): void {
  console.log(ansi.muted(title.toUpperCase()));
  if (!rows.length) {
    console.log(ansi.muted("  none"));
    console.log();
    return;
  }
  for (const row of rows) console.log(`  ${row}`);
  console.log();
}

export function workSummary(items: TranscriptItem[], live = false): string {
  if (live) return "in progress";
  const thinks = items.filter((item) => item.kind === "thinking").length;
  const consoles = items.filter((item) => item.kind === "console").length;
  const extras = items.filter((item) => item.kind !== "thinking" && item.kind !== "console").length;
  const parts = [
    thinks ? `${thinks} thinking` : "",
    consoles ? `${consoles} console` : "",
    extras ? `${extras} other` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "hidden";
}

export function printTranscript(items: TranscriptItem[], opts?: { debug?: boolean; expandWork?: boolean }): void {
  const grouped = groupTranscript(items);
  for (const [index, entry] of grouped.entries()) {
    if (entry.type === "work") {
      if (!opts?.debug && isPrelude(entry.items, index, grouped)) continue;
      printWork(entry.items, Boolean(opts?.expandWork));
    } else if (entry.item.kind === "user") {
      printKind("user");
      console.log(indent(wrap(entry.item.text.trim()), "  "));
      console.log();
    } else {
      printKind("assistant");
      console.log(indent(renderMarkdown(visibleAssistantText(entry.item.text)), "  "));
      const footnote = formatReplyFootnote(entry.item.meta);
      if (footnote) console.log(ansi.muted(`  ${footnote}`));
      console.log();
    }
  }
}

export function printWork(items: TranscriptItem[], expand: boolean): void {
  const width = cols();
  const summary = workSummary(items);
  const hint = expand ? "" : "   ▸ /work";
  const head = ` work · ${summary}${hint} `;
  console.log(ansi.line("╭") + ansi.muted(head.padEnd(width - 1)));
  if (!expand) {
    console.log(ansi.line("╰" + "─".repeat(width - 1)));
    console.log();
    return;
  }
  for (const entry of groupProcess(items)) {
    if (entry.type === "stream") {
      const color = entry.kind === "thinking" ? ansi.think : ansi.cons;
      const preview = (entry.texts.at(-1) ?? entry.kind).replace(/\s+/g, " ").trim();
      console.log(ansi.line("│ ") + color(entry.kind.toUpperCase()) + ansi.muted(`  ${clip(preview, width - 16)}`));
      const shown = expand ? entry.texts : [];
      for (const text of shown) {
        for (const row of wrap(text, width - 6).split("\n").slice(0, 16)) {
          console.log(ansi.line("│ ") + color(`  ${row}`));
        }
      }
    } else {
      const color = colorFor(entry.item.kind);
      console.log(ansi.line("│ ") + color(entry.item.kind.toUpperCase()));
      for (const row of wrap(entry.item.text.trim(), width - 6).split("\n").slice(0, 12)) {
        console.log(ansi.line("│ ") + color(`  ${row}`));
      }
    }
  }
  console.log(ansi.line("╰" + "─".repeat(width - 1)));
  console.log();
}

export const WORK_PANE = 8;

export function workView(text: string, width: number, height: number): string[] {
  const rows = wrap(text, Math.max(8, width)).split("\n");
  const view = rows.slice(-Math.max(1, height));
  while (view.length < height) view.unshift("");
  return view;
}

export function createLivePrinter(runId: () => string | undefined): { onEvent: (type: string, payload: Record<string, unknown>) => void; finish: () => void } {
  let started = false;
  let buf = "";
  const width = cols();
  const inner = WORK_PANE;

  const draw = (title: string) => {
    const view = workView(buf, width - 4, inner);
    const box = [
      ansi.line("╭") + ansi.muted(` ${title} `.padEnd(width - 1)),
      ...view.map((line) => ansi.line("│ ") + ansi.think(clip(line, width - 4))),
      ansi.line("╰" + "─".repeat(width - 1)),
    ];
    if (!started) {
      process.stdout.write(`${box.join("\n")}\n`);
      started = true;
      return;
    }
    process.stdout.write(`\x1b[${inner + 2}A`);
    for (const row of box) process.stdout.write(`\x1b[2K${row}\n`);
  };

  const onEvent = (type: string, payload: Record<string, unknown>) => {
    if (payload.runId && payload.runId !== runId()) return;
    if (type === "run.thinking_delta") {
      const raw = String(payload.delta ?? "");
      if (!raw) return;
      buf += raw;
      draw("work · in progress");
    }
    if (type === "run.console") {
      buf += `\n[console · ${String(payload.tool ?? "tool")}]`;
      draw("work · in progress");
    }
    if (type === "browser.shown" || type === "browser.opened") {
      buf += `\n[browser · ${clip(String(payload.url ?? ""), 48)}]`;
      draw("work · in progress");
    }
    if (type === "plugin.opened" || type === "skill.opened") {
      buf += `\n[plugin · ${String(payload.name ?? "")}]`;
      draw("work · in progress");
    }
    if (type === "memory.written") {
      buf += `\n[memory · ${String(payload.key ?? "")}]`;
      draw("work · in progress");
    }
    if (type === "agent.delegated") {
      buf += `\n[delegate · ${String(payload.agent ?? "")}]`;
      draw("work · in progress");
    }
  };
  return {
    onEvent,
    finish: () => {
      if (!started) return;
      draw("work");
    },
  };
}

function groupTranscript(items: TranscriptItem[]): Array<{ type: "work"; items: TranscriptItem[] } | { type: "row"; item: TranscriptItem }> {
  const grouped: Array<{ type: "work"; items: TranscriptItem[] } | { type: "row"; item: TranscriptItem }> = [];
  let work: TranscriptItem[] = [];
  const flush = () => {
    if (!work.length) return;
    grouped.push({ type: "work", items: work });
    work = [];
  };
  for (const item of items) {
    if (CHAT.has(item.kind)) {
      flush();
      grouped.push({ type: "row", item });
    } else {
      work.push(item);
    }
  }
  flush();
  return grouped;
}

type ProcessEntry =
  | { type: "stream"; kind: "thinking" | "console"; texts: string[] }
  | { type: "row"; item: TranscriptItem };

function groupProcess(items: TranscriptItem[]): ProcessEntry[] {
  const grouped: ProcessEntry[] = [];
  for (const item of items) {
    const last = grouped.at(-1);
    if ((item.kind === "thinking" || item.kind === "console") && last?.type === "stream" && last.kind === item.kind) {
      last.texts.push(item.text);
    } else if (item.kind === "thinking" || item.kind === "console") {
      grouped.push({ type: "stream", kind: item.kind, texts: [item.text] });
    } else {
      grouped.push({ type: "row", item });
    }
  }
  return grouped;
}

function isPrelude(
  items: TranscriptItem[],
  index: number,
  grouped: Array<{ type: "work"; items: TranscriptItem[] } | { type: "row"; item: TranscriptItem }>,
): boolean {
  return index === 0 && items.every((item) => item.kind === "system") && grouped.some((entry) => entry.type === "row");
}

function colorFor(kind: TranscriptItem["kind"]): (s: string) => string {
  if (kind === "thinking") return ansi.think;
  if (kind === "console") return ansi.cons;
  if (kind === "review") return ansi.review;
  if (kind === "research") return ansi.research;
  return ansi.muted;
}

export function renderMarkdown(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const lang = fence[1] || "code";
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]?.startsWith("```")) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      if (lang === "mermaid" || lang === "flowchart") {
        out.push(ansi.muted("[flowchart]"));
      } else if (lang === "canvas") {
        out.push(ansi.muted("CANVAS"));
        out.push(renderMarkdown(body.join("\n")));
      } else {
        out.push(ansi.muted(lang.toUpperCase()));
        for (const row of body.slice(0, 24)) out.push(ansi.dim(row));
        if (body.length > 24) out.push(ansi.dim("…"));
      }
      i += 1;
      continue;
    }
    if (/^#{1,3}\s+/.test(line)) {
      out.push(ansi.bold(ansi.text(line.replace(/^#{1,3}\s+/, ""))));
      i += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      out.push(`• ${inline(line.replace(/^[-*]\s+/, ""))}`);
      i += 1;
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      out.push(inline(line));
      i += 1;
      continue;
    }
    if (/^\|/.test(line)) {
      if (/^\|\s*[-:| ]+\|$/.test(line) || /^[-:| ]+$/.test(line.replace(/\|/g, ""))) {
        i += 1;
        continue;
      }
      out.push(ansi.dim(line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()).join("  ·  ")));
      i += 1;
      continue;
    }
    if (/^>\s+/.test(line)) {
      out.push(ansi.muted(`│ ${line.replace(/^>\s+/, "")}`));
      i += 1;
      continue;
    }
    if (!line.trim()) {
      out.push("");
      i += 1;
      continue;
    }
    out.push(wrap(inline(line)));
    i += 1;
  }
  return out.join("\n").trim();
}

function inline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, (_, inner: string) => ansi.bold(inner))
    .replace(/`([^`]+)`/g, (_, inner: string) => ansi.dim(inner));
}

function indent(text: string, prefix: string): string {
  return text.split("\n").map((line) => (line ? `${prefix}${line}` : "")).join("\n");
}

export function wrap(text: string, width = cols() - 4): string {
  return text.split("\n").map((line) => wrapLine(line, width)).join("\n");
}

function wrapLine(line: string, width: number): string {
  if (visibleLength(line) <= width) return line;
  const words = line.split(/(\s+)/);
  const rows: string[] = [];
  let current = "";
  for (const word of words) {
    if (visibleLength(current + word) > width && current.trim()) {
      rows.push(current.trimEnd());
      current = word.trimStart();
    } else {
      current += word;
    }
  }
  if (current) rows.push(current.trimEnd());
  return rows.join("\n");
}

export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;]*m/g, "").length;
}
