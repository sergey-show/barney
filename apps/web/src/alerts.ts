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

/**
 * Surface an interrupt/error only when it is still the latest event.
 * Later user/agent activity means the step was already continued.
 */
export function interruptedNotice(
  transcript: Array<{ kind: string; text: string }>,
  status?: string,
): Alert | null {
  if (status === "done" || status === "parked") return null;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const item = transcript[i];
    if (item.kind !== "system") return null;
    if (/interrupted|portal restarted/i.test(item.text)) {
      return { level: "warning", title: "Last step did not finish", detail: item.text };
    }
    if (/^error:/i.test(item.text)) {
      return { level: "error", title: "Agent error", detail: item.text };
    }
  }
  return null;
}

export function alertDismissKey(runId: string, alert: Pick<Alert, "detail">): string {
  return `${runId}:${alert.detail}`;
}
