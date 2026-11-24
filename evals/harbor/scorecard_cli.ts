#!/usr/bin/env bun
/**
 * Harbor scorecard aggregator (B.5): read JSONL scorecard entries (one per
 * task attempt) and emit an aggregate scoreboard JSON.
 *
 * Usage:
 *   bun evals/harbor/scorecard.ts <scorecards.jsonl>          # → stdout JSON
 *   bun evals/harbor/scorecard.ts <scorecards.jsonl> -o out.json  # → file
 *   cat a.jsonl b.jsonl | bun evals/harbor/scorecard.ts      # → stdin → stdout
 *
 * Each input line is a JSON ScorecardEntry (as written by `run.ts --scorecard`).
 * The output is a single JSON object with pass@1, pass@k, infra-fail count,
 * avg tokens/usd/duration, and a by-failure-kind breakdown.
 */

import { readFile, writeFile } from "node:fs/promises";
import { aggregateScoreboard, type ScorecardEntry } from "./scorecard.ts";

async function readInput(path: string): Promise<string> {
  if (path === "-") {
    return await new Response(Bun.stdin).text();
  }
  return await readFile(path, "utf8");
}

function parseEntries(text: string): ScorecardEntry[] {
  const entries: ScorecardEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as ScorecardEntry);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let inputPath = "-";
  let outputPath: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "bun evals/harbor/scorecard.ts <scorecards.jsonl> [-o out.json]\n  (use - for stdin/stdout)\n",
      );
      process.exit(0);
    }
    if (arg === "-o" || arg === "--output") {
      outputPath = argv[++i] ?? "-";
      continue;
    }
    if (arg.startsWith("-o=")) {
      outputPath = arg.slice(3) || "-";
      continue;
    }
    if (!arg.startsWith("-")) {
      inputPath = arg;
    }
  }
  const text = await readInput(inputPath);
  const entries = parseEntries(text);
  const board = aggregateScoreboard(entries);
  const json = JSON.stringify(board, null, 2) + "\n";
  if (!outputPath || outputPath === "-") {
    process.stdout.write(json);
  } else {
    await writeFile(outputPath, json);
    process.stderr.write(`harbor: scoreboard written to ${outputPath}\n`);
  }
}

await main();
