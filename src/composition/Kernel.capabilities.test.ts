import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDesignGoal, isDesignSealed } from "../application/psyche/design.ts";
import { designKey, samostKey } from "../application/psyche/keys.ts";
import { parseBoard } from "../application/psyche/board.ts";
import { INSTANCE_NAME } from "../application/psyche/samost.ts";
import { Kernel } from "./Kernel.ts";

test("capability exam: name, body, design, write, board, plugin", async () => {
  const home = mkdtempSync(join(tmpdir(), "barney-exam-"));
  const kernel = new Kernel(home);
  const report: string[] = [];
  const pass = (name: string, ok: boolean, detail = "") => {
    report.push(`${ok ? "ok" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
    expect(ok, `${name}${detail ? `: ${detail}` : ""}`).toBe(true);
  };

  const agent = await kernel.boot();
  pass("имя Barney", agent.name === INSTANCE_NAME, agent.name);
  pass("тело — git", existsSync(join(home, ".git")));
  pass("Self on disk", existsSync(join(home, "self", "samost.md")));
  pass("стартовые скиллы — владение собой", kernel.plugins.get("hold-the-act") != null && kernel.plugins.get("no-persona") != null);
  pass("нет кейсовых стартеров", kernel.plugins.get("copy-session-url") == null && kernel.plugins.get("timezone-not-city") == null);

  const posted = (await kernel.listRuns()).find((run) => isDesignGoal(run.goal));
  pass("самопознание постится", Boolean(posted), posted?.id.value);
  if (!posted) return;

  const designed = await kernel.send(posted.id.value, "канон");
  const designNote = await kernel.memories.get(designKey(agent.id.value));
  const samost = await kernel.memories.get(samostKey(agent.id.value));
  const after = await kernel.agents.get(agent.id.value);
  pass("проектирование каноном", isDesignSealed(designNote?.body));
  pass("конституция без You are", !/^you are/i.test(after?.constitution ?? ""));
  pass("Self holds the dedication", Boolean(samost?.body.includes("dedication")));
  pass("ответ самопознания", designed.transcript.some((item) => item.kind === "assistant" && /Barney/.test(item.text)));

  const work = await kernel.createRun("create notes.md with the word barney-capability");
  const done = await kernel.send(work.id.value, "create notes.md with the word barney-capability");
  const notes = join(work.worktreePath, "notes.md");
  const wrote = existsSync(notes) && readFileSync(notes, "utf8").includes("barney-capability");
  pass("fs_write в worktree", wrote, notes);
  pass("ход оставил console", done.transcript.some((item) => item.kind === "console"));

  const boardNote = await kernel.memories.get(`tree/${work.id.value}`);
  const board = parseBoard(boardNote?.body ?? "");
  const motive = board.find((item) => item.kind === "motive")?.text ?? "";
  pass("мотив сессии заперт на goal", motive.includes("notes.md"));

  kernel.plugins.writeFile("exam-probe", "plugin.json", JSON.stringify({
    name: "exam-probe",
    version: "1",
    description: "capability exam",
  }));
  pass("плагин в теле", kernel.plugins.list().some((plugin) => plugin.name === "exam-probe"));

  const secret = "sk-live-abcdefghijklmnopqrstuvwxyz123456";
  const masked = kernel.mask(`token=${secret}`);
  pass("секреты маскируются", !masked.includes(secret));
  pass("секрет помечен как DETECTED_SECRET", /DETECTED_SECRET_/.test(masked));
  pass("плейсхолдер раскрывается обратно", kernel.reveal(masked).includes(secret));

  const body = await kernel.homeRepo.status();
  pass("git тела жив", /HEAD|clean|self/i.test(body));

  console.log(`\nBarney capability exam\n${report.join("\n")}\n`);
}, 30_000);
