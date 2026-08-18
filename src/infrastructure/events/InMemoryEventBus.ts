import type { EventBus } from "../../application/ports.ts";
import type { DomainEvent } from "../../domain/shared/DomainEvent.ts";

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Set<(event: DomainEvent) => void>();
  readonly history: DomainEvent[] = [];

  publish(events: DomainEvent[]): void {
    for (const event of events) {
      this.history.push(event);
      for (const handler of this.handlers) handler(event);
    }
  }

  subscribe(handler: (event: DomainEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
