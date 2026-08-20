export type TurnRoute = {
  topic: string;
  short: boolean;
  needResearch: boolean;
  analysis: string;
  plan: string[];
};

export const ROUTE_RULES = `Analyze this turn. Do not answer the user. Do not pick a model — one model will do the work.

short=true only for a greeting, who-are-you, or an opinion that needs no tools and no world facts.
short=false for files, shell, browser, plugins, time, a deliverable, or checking a previous turn.

need_research=true only if the answer depends on current external sources (docs, API, news). Local machine, worktree, who-are-you — false.

analysis: what must be true when the request is done (1-3 sentences). Empty if short.
plan: ordered concrete steps. Empty if short. Each step is one action.

JSON only, no prose:
{"topic":"brief","short":false,"need_research":false,"analysis":"...","plan":["..."]}`;

export function shouldEscalateFromShort(text: string): boolean {
  return /NEED_TOOLS/i.test(text);
}

export function parseTurnRoute(raw: string): TurnRoute {
  const text = peelRouteText(raw);
  const json = firstRouteObject(text);
  if (json) {
    const topic = String(json.topic ?? "").trim();
    const needResearch = asBool(json.need_research ?? json.needResearch);
    const short = parseShort(json, needResearch);
    return {
      topic,
      short,
      needResearch,
      analysis: String(json.analysis ?? "").trim(),
      plan: asPlan(json.plan),
    };
  }
  const shortLoose = text.match(/\bshort["']?\s*[:=]\s*(true|false|yes|no)/i);
  const largeLoose = text.match(/need_large["']?\s*[:=]\s*(true|false|yes|no)/i);
  const researchLoose = text.match(/need_research["']?\s*[:=]\s*(true|false|yes|no)/i);
  if (shortLoose?.[1] || largeLoose?.[1] || researchLoose?.[1]) {
    const needResearch = asBool(researchLoose?.[1]);
    const short = shortLoose?.[1] ? asBool(shortLoose[1]) && !needResearch : !asBool(largeLoose?.[1]) && !needResearch;
    return { topic: "", short, needResearch, analysis: "", plan: [] };
  }
  return { topic: "", short: false, needResearch: false, analysis: "", plan: [] };
}

function parseShort(json: Record<string, unknown>, needResearch: boolean): boolean {
  if (needResearch) return false;
  if ("short" in json) return asBool(json.short);
  if ("need_large" in json || "needLarge" in json || "need_model" in json) {
    return !asBool(json.need_large ?? json.needLarge ?? json.need_model);
  }
  return false;
}

function asPlan(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split("\n").map((line) => line.replace(/^\d+[.)]\s*/, "").trim()).filter(Boolean);
  }
  return [];
}

function peelRouteText(raw: string): string {
  return (raw ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1")
    .trim();
}

function firstRouteObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  for (let end = text.indexOf("}", start); end >= 0; end = text.indexOf("}", end + 1)) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const obj = parsed as Record<string, unknown>;
      if (
        "short" in obj
        || "need_large" in obj
        || "needLarge" in obj
        || "need_research" in obj
        || "needResearch" in obj
        || "topic" in obj
        || "plan" in obj
        || "analysis" in obj
      ) return obj;
    } catch {
      /* try a longer slice */
    }
  }
  return null;
}

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return /^(1|true|yes|y)$/i.test(value.trim());
  return false;
}
