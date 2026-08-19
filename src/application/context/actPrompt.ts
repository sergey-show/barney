export type ActPromptInput = {
  constitution: string;
  samost: string;
  existence: string;
  board: string;
  goal: string;
  anchors: string[];
  plan: string;
  worktree: string;
  depth: number;
  skills: string;
  memory: string;
};

/** Operator turn law still stored on constitution: language + Never. Not the Self essay. */
export function turnLawFromConstitution(constitution: string): string {
  const language = constitution.match(/Language(?: with the operator)?:\s*(.+)/i)?.[1]?.trim() ?? "";
  const never = neverLines(constitution);
  return [
    language ? `Language with the operator: ${language}` : "",
    never.length ? `Never:\n${never.map((line) => `- ${line}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildActSystem(input: ActPromptInput): string {
  const tools =
    input.depth > 0
      ? "Tools this turn: fs_*, shell, process_*, web_search, plugin_*, browser_*, memory_*, board_read/write, mcp_list/start/call/stop/write, agent_list, self_status/log/commit."
      : "Tools this turn: fs_*, shell, process_spawn/list/logs/kill, web_search, plugin_list/read/write/open, browser_*, memory_search/write/read, board_read/write, plan_set, agent_list/spawn/delegate, mcp_list/write/start/call/stop, self_status/log/commit/rollback.";
  return [
    turnLawFromConstitution(input.constitution),
    input.samost,
    input.existence,
    input.board,
    `Session goal (copy URLs/IPs exactly): ${input.goal}`,
    input.anchors.length
      ? `Session facts (copy exactly, never truncate or guess):\n${input.anchors.map((a) => `- ${a}`).join("\n")}`
      : "",
    input.plan ? `Working plan (execute in order; do not skip to guessing):\n${input.plan}` : "",
    `Worktree: ${input.worktree}. File paths are relative to it.`,
    input.depth > 0
      ? "Delegated specialist, not a character. Do the subtask. Write notes with memory_write. Do not spawn agents."
      : "",
    tools,
    "Secrets in tool output are DETECTED_SECRET_<KIND>_<HASH>. Use that token in edits; do not ask for the value.",
    "Visible reply: Markdown. mermaid or canvas fences when they help.",
    input.skills,
    input.memory ? `Shared memory and past episodes:\n${input.memory}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function neverLines(constitution: string): string[] {
  const block = constitution.match(/(?:^|\n)Never:\s*\n((?:[-*].+\n?)*)/i)?.[1] ?? "";
  return block
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
}
