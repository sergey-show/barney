export function samostKey(agentId: string): string {
  return `samost/${agentId}`;
}

export function existenceKey(runId: string): string {
  return `existence/${runId}`;
}

export function boardKey(runId: string): string {
  return `tree/${runId}`;
}

export function designKey(agentId: string): string {
  return `design/${agentId}`;
}
