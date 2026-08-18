export type DomainEvent = {
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export function event(type: string, payload: Record<string, unknown> = {}): DomainEvent {
  return { type, occurredAt: new Date().toISOString(), payload };
}
