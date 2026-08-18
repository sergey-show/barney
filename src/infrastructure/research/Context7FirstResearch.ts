import type { ResearchHit, ResearchPort } from "../../application/ports.ts";

export class Context7FirstResearch implements ResearchPort {
  private readonly seen = new Set<string>();

  async lookup(_query: string, _signal?: AbortSignal): Promise<ResearchHit[]> {
    return [];
  }

  async search(query: string, signal?: AbortSignal): Promise<string> {
    const key = query.trim().toLowerCase();
    if (this.seen.has(key)) return `Skipped duplicate research query: ${query}`;
    this.seen.add(key);

    const notes: string[] = [`Context7-first query: ${query}`];
    const context7 = process.env.CONTEXT7_API_KEY;
    if (context7) {
      try {
        const res = await fetch("https://context7.com/api/v1/search", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${context7}` },
          body: JSON.stringify({ query }),
          signal,
        });
        if (res.ok) notes.push(await res.text());
        else notes.push(`Context7 HTTP ${res.status}`);
      } catch (err) {
        notes.push(`Context7 unavailable: ${String(err)}`);
      }
    } else {
      notes.push("Context7 not configured (CONTEXT7_API_KEY). Using local catalog notes.");
      notes.push("Registry: prefer an existing MCP over writing a new one. Prefer a skill over a server.");
    }
    return notes.join("\n");
  }
}
