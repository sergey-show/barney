import { InvariantError } from "../shared/DomainError.ts";

export class Budget {
  tokensUsed = 0;
  usdUsed = 0;
  startedAt = Date.now();

  constructor(
    readonly tokenLimit: number,
    readonly usdLimit: number,
    readonly msLimit: number,
  ) {}

  charge(tokens: number, usd: number): void {
    this.tokensUsed += tokens;
    this.usdUsed += usd;
  }

  exhausted(): boolean {
    return (
      this.tokensUsed >= this.tokenLimit ||
      this.usdUsed >= this.usdLimit ||
      Date.now() - this.startedAt >= this.msLimit
    );
  }

  assertAvailable(): void {
    if (this.exhausted()) throw new InvariantError("run budget exhausted");
  }
}
