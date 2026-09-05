import type { LlmProvider } from "../../domain/provider/LlmProvider.ts";

/** OpenAI-compatible embeddings. Returns null when the host does not support them. */
export async function fetchEmbeddings(
  provider: LlmProvider,
  model: string,
  texts: string[],
  signal?: AbortSignal,
): Promise<number[][] | null> {
  if (provider.kind === "stub" || provider.kind === "anthropic") return null;
  if (!texts.length) return [];
  const url = `${provider.baseUrl.replace(/\/$/, "")}/embeddings`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}),
      },
      body: JSON.stringify({ model, input: texts.map((text) => text.slice(0, 2000)) }),
      signal,
    });
    if (!res.ok) return null;
    const json = await res.json() as {
      data?: Array<{ embedding?: number[]; index?: number }>;
    };
    const rows = json.data ?? [];
    if (!rows.length) return null;
    const ordered = [...rows].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = ordered.map((row) => row.embedding ?? []);
    if (vectors.some((vec) => !vec.length)) return null;
    return vectors;
  } catch {
    return null;
  }
}
