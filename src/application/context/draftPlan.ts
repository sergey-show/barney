export function draftPlan(input: { goal: string; latest: string; anchors: string[]; markers?: string[] }): string[] {
  const markers = (input.markers ?? []).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const markerBlob = markers.join("\n");
  const text = `${input.goal}\n${input.latest}\n${markerBlob}`;
  const url = input.anchors.find((item) => /^https?:\/\//i.test(item));
  const steps: string[] = [];
  if (url) steps.push(`Open the exact URL ${url} (copy it whole; do not guess)`);
  if (markers[0]) steps.push(`Marker from past fail (apply before guessing): ${clip(markers[0], 140)}`);
  if (/login|password|user(name)?/i.test(text)) {
    steps.push("Sign in with credentials already given in this session; do not store the password");
  }
  if (/plugin/i.test(text)) {
    steps.push("Reuse or write a plugin, then call it");
  }
  if (/\.md\b|\.txt\b|\bmarkdown\b|\bmd\b/i.test(text)) {
    steps.push("Write the requested file in the worktree after you have the facts");
  }
  if (/empty|not found|another path/i.test(markerBlob)) {
    steps.push("If the first path is empty, try another path on the same host");
  }
  if (!steps.length) steps.push(`Do the requested work now: ${clip(input.latest || input.goal, 160)}`);
  steps.push("Verify the concrete result, then reply with it — not a plan of what you would try");
  return [...new Set(steps)].slice(0, 6);
}

export function formatPlan(steps: string[]): string {
  return steps.map((step, index) => `${index + 1}. ${step.replace(/^\d+[.)]\s*/, "")}`).join("\n");
}

function clip(text: string, max: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}
