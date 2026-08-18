export type TurnRoute = {
  topic: string;
  needLarge: boolean;
  needResearch: boolean;
};

export const ROUTE_RULES = `Decide the topic of this turn, whether the large model is needed, and whether a web search is needed. This is routing, not a reply to the user.

need_large=true if tools are required: files, browser, shell, plugins, time, date, city, hardware, URL, create/open an artifact, continue or check a previous turn.
need_large=false: greeting, who are you, explain an idea, an opinion that does not check world facts.

need_research=true only if the answer depends on current external sources (docs, API, news, a comparison on the web). Local machine, time, worktree files, "who are you" — false.
need_research=true implies need_large=true.

Reply with exactly one JSON object, no prose, no markdown:
{"topic":"brief","need_large":true,"need_research":false}`;

export function shouldEscalateFromShort(text: string): boolean {
  return /NEED_TOOLS/i.test(text);
}

export function parseTurnRoute(raw: string): TurnRoute {
  const text = peelRouteText(raw);
  const json = firstRouteObject(text);
  if (json) {
    const topic = String(json.topic ?? "").trim();
    const needResearch = asBool(json.need_research ?? json.needResearch);
    const needLarge = asBool(json.need_large ?? json.needLarge ?? json.need_model) || needResearch;
    return { topic, needLarge, needResearch };
  }
  const largeLoose = text.match(/need_large["']?\s*[:=]\s*(true|false|yes|no)/i);
  const researchLoose = text.match(/need_research["']?\s*[:=]\s*(true|false|yes|no)/i);
  if (largeLoose?.[1] || researchLoose?.[1]) {
    const needResearch = asBool(researchLoose?.[1]);
    const needLarge = asBool(largeLoose?.[1]) || needResearch;
    return { topic: "", needLarge, needResearch };
  }
  return { topic: "", needLarge: true, needResearch: false };
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
        "need_large" in obj
        || "needLarge" in obj
        || "need_research" in obj
        || "needResearch" in obj
        || "topic" in obj
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
