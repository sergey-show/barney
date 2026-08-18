export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

export class InvariantError extends DomainError {
  constructor(message: string) {
    super("invariant", message);
    this.name = "InvariantError";
  }
}
