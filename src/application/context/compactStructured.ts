/**
 * Structured compaction helpers — Goal / Progress / Decisions / files.
 */

export type CompactFileLists = {
  readFiles: string[];
  modifiedFiles: string[];
};

export function extractFileListsFromTranscript(
  transcript: Array<{ kind: string; text: string }>,
): CompactFileLists {
  const read = new Set<string>();
  const modified = new Set<string>();
  for (const item of transcript) {
    if (item.kind !== "console") continue;
    const head = item.text.split("\n")[0] ?? "";
    const tool = head.match(/^(\w+)\s+/)?.[1] ?? "";
    let path = "";
    try {
      const jsonStart = head.indexOf("{");
      if (jsonStart >= 0) {
        const args = JSON.parse(head.slice(jsonStart)) as { path?: string; pattern?: string };
        path = String(args.path ?? args.pattern ?? "");
      }
    } catch {
      path = head.match(/"path"\s*:\s*"([^"]+)"/)?.[1] ?? "";
    }
    if (!path) continue;
    if (/^(fs_read|grep|glob)$/i.test(tool)) read.add(path);
    if (/^(fs_write|fs_edit|fs_append|patch)$/i.test(tool)) modified.add(path);
  }
  return {
    readFiles: [...read].slice(-40),
    modifiedFiles: [...modified].slice(-40),
  };
}

export function structuredCompactSystemPrompt(): string {
  return [
    "Summarize this coding session for continuation.",
    "Use this exact structure:",
    "## Goal",
    "## Progress",
    "## Decisions",
    "## Open tasks / blockers",
    "## Read files",
    "## Modified files",
    "Keep bullets short. Prefer concrete paths. Write in the user's language when clear.",
  ].join("\n");
}

export function formatFileListsForCompact(lists: CompactFileLists): string {
  const lines = [
    lists.readFiles.length ? `<read-files>\n${lists.readFiles.map((p) => `- ${p}`).join("\n")}\n</read-files>` : "",
    lists.modifiedFiles.length
      ? `<modified-files>\n${lists.modifiedFiles.map((p) => `- ${p}`).join("\n")}\n</modified-files>`
      : "",
  ].filter(Boolean);
  return lines.join("\n");
}
