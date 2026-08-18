import type { BrowserPort, ResearchHit, ResearchPort } from "../ports.ts";
import type { ChatMessage, ChatResult, Role } from "../../domain/provider/Role.ts";
import { formatHits } from "../../infrastructure/research/webSearch.ts";
import { clipPage } from "./clipPage.ts";

export type ResearchBrief = {
  query: string;
  text: string;
  sources: ResearchHit[];
  tokens: number;
  usd: number;
  ms: number;
  model?: string;
};

type Complete = (role: Role, messages: ChatMessage[]) => Promise<ChatResult>;

const MAX_QUESTIONS = 3;
const MAX_PAGES = 4;

const PLAN_SYSTEM = `Role: researcher. Break the question into at most 3 web search queries that would let you verify the answer from independent sources.
Prefer official docs, primary sources, and two different sites for the same claim.
Reply as JSON only: {"questions":["..."]}`;

const SYNTH_SYSTEM = `Role: researcher. Write a brief for the coder from the dossier only.
Rules:
- Quote only text that appears under an "Opened" dump. Search snippets are not quotes.
- Do not name an API, flag, or method unless those exact characters appear in an Opened dump.
- If no Opened dump contains a solution, write: unknown — pages did not include a solution. Do not guess an API.
- Separate facts supported by two sources from single-source claims.
- Copy URLs in full. Never truncate a URL or IP.
- If sources disagree, say so.
- Do not invent. Do not answer the user yet — this is evidence, not the final reply.
Markdown. End with:
## Sources
- full URL — why it matters`;

export async function runDeepResearch(input: {
  query: string;
  goal: string;
  runId: string;
  known?: string;
  signal?: AbortSignal;
  search: ResearchPort;
  browser: BrowserPort;
  complete: Complete;
}): Promise<ResearchBrief> {
  const started = Date.now();
  let tokens = 0;
  let usd = 0;
  let model: string | undefined;
  const charge = (result: ChatResult) => {
    tokens += result.tokens;
    usd += result.usd;
    model = result.model || model;
  };

  const plan = await input.complete("researcher", [
    { role: "system", content: PLAN_SYSTEM },
    { role: "user", content: `Session goal: ${input.goal}\nQuestion: ${input.query}\nAlready known:\n${input.known || "(none)"}` },
  ]);
  charge(plan);
  const questions = parseQuestions(plan.text, input.query);

  const sources: ResearchHit[] = [];
  const dossier: string[] = [];
  let pages = 0;

  for (const question of questions) {
    if (input.signal?.aborted) break;
    const hits = await input.search.lookup(question, input.signal).catch(() => [] as ResearchHit[]);
    for (const hit of hits) {
      if (!sources.some((item) => item.url === hit.url)) sources.push(hit);
    }
    dossier.push(`Search: ${question}\n${formatHits(hits.slice(0, 5))}`);
    for (const hit of hits.slice(0, 2)) {
      if (pages >= MAX_PAGES || input.signal?.aborted) break;
      pages += 1;
      try {
        const page = await input.browser.open({ runId: input.runId, url: hit.url, signal: input.signal });
        dossier.push(`Opened ${page.url}\n${page.title}\n${clipPage(page.text, input.query, 2200)}`);
      } catch (err) {
        dossier.push(`Failed ${hit.url}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const synth = await input.complete("researcher", [
    { role: "system", content: SYNTH_SYSTEM },
    {
      role: "user",
      content: `Question: ${input.query}\nAlready known:\n${input.known || "(none)"}\n\nDossier:\n${dossier.join("\n\n").slice(0, 12_000)}`,
    },
  ]);
  charge(synth);

  return {
    query: input.query,
    text: synth.text.trim() || dossier.join("\n\n"),
    sources: sources.slice(0, 8),
    tokens,
    usd,
    ms: Date.now() - started,
    model,
  };
}

export function formatResearchBrief(brief: ResearchBrief): string {
  const urls = brief.sources.map((hit) => `- ${hit.url} — ${hit.title}`).join("\n");
  return [
    `Deep research: ${brief.query}`,
    brief.text,
    urls ? `Collected URLs:\n${urls}` : "",
  ].filter(Boolean).join("\n\n");
}

export function parseQuestions(text: string, fallback: string): string[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { questions?: unknown };
      if (Array.isArray(parsed.questions)) {
        const questions = parsed.questions.map((item) => String(item).trim()).filter((item) => item.length > 2);
        if (questions.length) return questions.slice(0, MAX_QUESTIONS);
      }
    } catch {
      /* fallthrough */
    }
  }
  return [fallback.trim()].filter(Boolean).slice(0, 1);
}
