import { InvariantError } from "./DomainError.ts";

export abstract class Id {
  readonly value: string;

  protected constructor(value: string) {
    const trimmed = value.trim();
    if (!trimmed) throw new InvariantError("id must not be empty");
    this.value = trimmed;
  }

  equals(other: Id): boolean {
    return this.constructor === other.constructor && this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}
