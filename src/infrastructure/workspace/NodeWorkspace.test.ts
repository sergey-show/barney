import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeWorkspace } from "./NodeWorkspace.ts";

const root = mkdtempSync(join(tmpdir(), "barney-ws-"));
mkdirSync(join(root, "src"));
writeFileSync(join(root, "readme.md"), "hello token=ghp_examplesecretvalue123");
writeFileSync(join(root, "src", "app.ts"), "export const n = 1;\n");

const ws = new NodeWorkspace(root, (text) => text.replace(/ghp_[A-Za-z0-9]+/g, "{{SECRET:token:hash}}"));

const listed = await ws.list(".");
if (!listed.includes("readme.md") || !listed.includes("src")) throw new Error(`list: ${listed}`);

const read = await ws.read("readme.md");
if (read.includes("ghp_")) throw new Error(`secret leaked: ${read}`);
if (!read.includes("{{SECRET:token:hash}}")) throw new Error(`mask missing: ${read}`);

await ws.write("src/nested/note.txt", "ok");
const nested = await ws.read("src/nested/note.txt");
if (nested !== "ok") throw new Error(nested);

await ws.append("src/nested/note.txt", "line2");
const appended = await ws.read("src/nested/note.txt");
if (appended !== "ok\nline2") throw new Error(`append: ${appended}`);

await ws.edit("src/nested/note.txt", "line2", "line3");
const edited = await ws.read("src/nested/note.txt");
if (edited !== "ok\nline3") throw new Error(`edit: ${edited}`);

let editFailed = false;
try {
  await ws.edit("src/nested/note.txt", "missing", "x");
} catch (err) {
  editFailed = err instanceof Error && err.message.includes("not found");
}
if (!editFailed) throw new Error("edit should fail when old is missing");

const hits = await ws.search("export const");
if (!hits.includes("src/app.ts")) throw new Error(`search: ${hits}`);

let escaped = false;
try {
  ws.resolveSafe("../outside.txt");
} catch {
  escaped = true;
}
if (!escaped) throw new Error("jail failed for ../");

escaped = false;
try {
  ws.resolveSafe("src/../../outside.txt");
} catch {
  escaped = true;
}
if (!escaped) throw new Error("jail failed for nested ..");

const sh = await ws.shell("echo hello-barney");
if (!sh.includes("hello-barney")) throw new Error(`shell: ${sh}`);

let blocked = false;
try {
  await ws.shell("sudo ls");
} catch (err) {
  blocked = err instanceof Error && err.message.includes("blocked");
}
if (!blocked) throw new Error("shell should block sudo");

console.log("workspace jail ok");
