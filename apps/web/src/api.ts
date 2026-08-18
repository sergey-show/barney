export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    try {
      const parsed = JSON.parse(text) as { error?: unknown };
      if (typeof parsed?.error === "string" && parsed.error.trim()) throw new Error(parsed.error);
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
    }
    throw new Error(text || `${res.status} ${path}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export function jsonBody(data: unknown): RequestInit {
  return { headers: { "content-type": "application/json" }, body: JSON.stringify(data) };
}
