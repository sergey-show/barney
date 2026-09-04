export type Alert = {
  level: "error" | "warning";
  title: string;
  detail: string;
  allowPrefix?: string;
};

export function classifyClientError(err: unknown): Alert {
  const detail = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed|econnrefused|network request failed/i.test(detail)) {
    return {
      level: "warning",
      title: "Connection lost",
      detail: "The portal restarted or the network dropped while the agent was working.",
    };
  }
  return { level: "error", title: "Request failed", detail };
}

export function interruptedNotice(transcript: Array<{ kind: string; text: string }>): Alert | null {
  const lastSys = [...transcript].reverse().find((item) => item.kind === "system");
  if (!lastSys) return null;
  if (/interrupted|portal restarted/i.test(lastSys.text)) {
    return { level: "warning", title: "Last step did not finish", detail: lastSys.text };
  }
  if (/^error:/i.test(lastSys.text)) {
    return { level: "error", title: "Agent error", detail: lastSys.text };
  }
  return null;
}
