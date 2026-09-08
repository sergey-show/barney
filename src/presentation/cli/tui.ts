import { visibleAssistantText } from "../../infrastructure/llm/visibleReply.ts";
import type { TranscriptItem } from "../../domain/run/Run.ts";
import {
  ansi,
  clip,
  logoLines,
  renderMarkdown,
  visibleLength,
  wrap,
  workView,
} from "./render.ts";

const ESC = "\x1b";

export type Tui = {
  log: (kind: string, text: string) => void;
  setSession: (id: string, worktree?: string, sessionDir?: string) => void;
  setStatus: (text: string) => void;
  setChat: (items: TranscriptItem[]) => void;
  livePrinter: (runId: () => string | undefined) => { onEvent: (type: string, payload: Record<string, unknown>) => void; finish: () => void };
  toggleWork: () => void;
  prompt: () => void;
  close: () => void;
};

type ChatLine = { kind: string; text: string };

export function openTui(header: { agent: string; model?: string; onInterrupt?: () => void }): Tui | null {
  if (!process.stdout.isTTY || process.env.BARNEY_TUI === "0") return null;

  const chat: ChatLine[] = [];
  let session = "";
  let worktree = "";
  let sessionDir = "";
  let status = "";
  let work = "";
  let working = false;
  let workOpen = false;
  let closed = false;

  const write = (s: string) => process.stdout.write(s);
  const move = (row: number, col: number) => write(`${ESC}[${row};${col}H`);
  const hide = () => write(`${ESC}[?25l`);
  const show = () => write(`${ESC}[?25h`);

  function dim() {
    return {
      cols: Math.max(40, process.stdout.columns ?? 80),
      rows: Math.max(16, process.stdout.rows ?? 24),
    };
  }

  function layout() {
    const { cols, rows } = dim();
    const logo = cols >= 64 && rows >= 24 ? logoLines().length + 1 : 1;
    const meta = 3;
    const prompt = 2;
    const workBody = working || workOpen ? Math.min(8, Math.max(3, Math.floor(rows * 0.22))) : 1;
    const workBox = workBody + 2;
    const chatH = Math.max(3, rows - logo - meta - workBox - prompt);
    let row = 1;
    const logoRow = row;
    row += logo;
    const metaRow = row;
    row += meta;
    const chatRow = row;
    row += chatH;
    const workRow = row;
    row += workBox;
    const promptRow = rows;
    return { cols, rows, logo, meta, chatH, workBody, logoRow, metaRow, chatRow, workRow, promptRow };
  }

  function pad(text: string, width: number): string {
    const vis = visibleLength(text);
    if (vis > width) return clip(text, width);
    return vis < width ? `${text}${" ".repeat(width - vis)}` : text;
  }

  function paintChat(kind: string, text: string): string {
    if (kind === "user") return ansi.accent(text);
    if (kind === "assistant") return ansi.text(text);
    if (kind === "error") return ansi.error(text);
    if (kind === "success") return ansi.cons(text);
    return ansi.muted(text);
  }

  function chatLines(width: number, height: number): string[] {
    const raw: ChatLine[] = [];
    for (const line of chat) {
      const body = line.kind === "assistant" ? renderMarkdown(line.text) : line.text;
      const label = line.kind === "user"
        ? "YOU"
        : line.kind === "assistant"
          ? "BARNEY"
          : line.kind === "error"
            ? "ERROR"
            : "INFO";
      raw.push({ kind: line.kind, text: ansi.bold(label) });
      for (const row of wrap(body, Math.max(12, width - 3)).split("\n")) {
        raw.push({ kind: line.kind, text: row ? `  ${row}` : "" });
      }
      raw.push({ kind: line.kind, text: "" });
    }
    return raw.slice(-height).map((line) => paintChat(line.kind, clip(line.text, width)));
  }

  function render(full = true) {
    if (closed) return;
    const L = layout();
    if (full) {
      hide();
      write(`${ESC}[2J`);
      let r = L.logoRow;
      const logo = L.logo > 1 ? logoLines() : [logoLines()[0] ?? "Barney"];
      for (const line of logo) {
        move(r, 1);
        write(pad(line, L.cols));
        r += 1;
      }
      move(L.metaRow, 1);
      write(pad(`  ${ansi.bold(ansi.text(header.agent))}${header.model ? ansi.muted(`  ·  ${header.model}`) : ansi.error("  ·  model not configured")}`, L.cols));
      move(L.metaRow + 1, 1);
      write(pad(ansi.muted("  /help  /new  /sessions  /memory  /work  /status  /quit"), L.cols));
      move(L.metaRow + 2, 1);
      const meta = [
        status && statusBadge(status),
        session && `session ${session.slice(0, 12)}`,
        worktree && clip(worktree, 44),
        sessionDir && sessionDir !== worktree && `data ${clip(sessionDir, 32)}`,
      ].filter(Boolean).join("  ·  ");
      write(pad(ansi.muted(meta ? `  ${meta}` : ""), L.cols));
      const shown = chatLines(L.cols - 2, L.chatH);
      for (let i = 0; i < L.chatH; i++) {
        move(L.chatRow + i, 1);
        write(pad(shown[i] ? `  ${shown[i]}` : "", L.cols));
      }
    }
    drawWork(L);
    if (full && !working) drawPrompt(L);
  }

  function drawWork(L = layout()) {
    const title = working ? "activity · running" : workOpen ? "activity · expanded" : "activity · /work to expand";
    const head = ` ${title} `;
    const fill = Math.max(0, L.cols - 2 - head.length);
    const view = workView(work, Math.max(8, L.cols - 4), L.workBody);
    move(L.workRow, 1);
    write(pad(ansi.line("╭") + ansi.muted(head) + ansi.line("─".repeat(fill) + "╮"), L.cols));
    for (let i = 0; i < L.workBody; i++) {
      move(L.workRow + 1 + i, 1);
      const body = clip(view[i] ?? "", Math.max(0, L.cols - 4));
      write(pad(ansi.line("│ ") + ansi.think(body) + ansi.line(" │"), L.cols));
    }
    move(L.workRow + 1 + L.workBody, 1);
    write(pad(ansi.line("╰" + "─".repeat(Math.max(0, L.cols - 2)) + "╯"), L.cols));
  }

  function drawPrompt(L = layout()) {
    show();
    move(L.promptRow - 1, 1);
    const label = session ? " message " : " new task ";
    write(pad(ansi.line(`─${label}${"─".repeat(Math.max(0, L.cols - label.length - 1))}`), L.cols));
    move(L.promptRow, 1);
    write(pad(ansi.accent("› "), L.cols));
    move(L.promptRow, 3);
  }

  write(`${ESC}[?1049h${ESC}[?7l`);
  render(true);

  const onResize = () => render(true);
  const onExit = () => {
    if (working && header.onInterrupt) {
      header.onInterrupt();
      chat.push({ kind: "system", text: "Stopping the active step…" });
      render(true);
      return;
    }
    close();
    process.exit(130);
  };
  process.stdout.on("resize", onResize);
  process.on("SIGINT", onExit);
  process.on("SIGTERM", onExit);

  function close() {
    if (closed) return;
    closed = true;
    process.stdout.off("resize", onResize);
    process.off("SIGINT", onExit);
    process.off("SIGTERM", onExit);
    write(`${ESC}[?7h${ESC}[?25h${ESC}[?1049l`);
  }

  return {
    log(kind, text) {
      chat.push({ kind, text });
      render(true);
    },
    setSession(id, path, dir) {
      session = id;
      worktree = path ?? "";
      sessionDir = dir ?? "";
      render(true);
    },
    setStatus(text) {
      status = text;
      working = false;
      render(true);
    },
    setChat(items) {
      chat.length = 0;
      for (const item of items) {
        if (item.kind === "user") chat.push({ kind: "user", text: item.text.trim() });
        if (item.kind === "assistant") chat.push({ kind: "assistant", text: visibleAssistantText(item.text) });
      }
      render(true);
    },
    livePrinter(runId) {
      work = "";
      working = true;
      hide();
      drawWork();
      return {
        onEvent(type, payload) {
          if (payload.runId && payload.runId !== runId()) return;
          if (type === "run.thinking_delta") {
            const raw = String(payload.delta ?? "");
            if (!raw) return;
            work += raw;
            drawWork();
          }
          if (type === "run.console") {
            work += `\n[console · ${String(payload.tool ?? "tool")}]`;
            drawWork();
          }
          if (type === "browser.shown" || type === "browser.opened") {
            work += `\n[browser · ${clip(String(payload.url ?? ""), 48)}]`;
            drawWork();
          }
          if (type === "plugin.opened" || type === "skill.opened") {
            work += `\n[plugin · ${String(payload.name ?? "")}]`;
            drawWork();
          }
          if (type === "memory.written") {
            work += `\n[memory · ${String(payload.key ?? "")}]`;
            drawWork();
          }
          if (type === "agent.delegated") {
            work += `\n[delegate · ${String(payload.agent ?? "")}]`;
            drawWork();
          }
        },
        finish() {
          working = false;
          drawWork();
        },
      };
    },
    toggleWork() {
      workOpen = !workOpen;
      render(true);
    },
    prompt() {
      render(true);
    },
    close,
  };
}

function statusBadge(status: string): string {
  const value = status.split("·")[0]?.trim() || status;
  const mark = value === "failed" || value === "parked" ? ansi.error("●") : value === "ready" || value === "done" ? ansi.cons("●") : ansi.accent("●");
  return `${mark} ${status}`;
}
