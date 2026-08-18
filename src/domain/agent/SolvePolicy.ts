import { InvariantError } from "../shared/DomainError.ts";

export type ExhaustedAction = "park";

export type SolvePolicyProps = {
  minStrategies: number;
  maxAttempts: number;
  maxSameFailure: number;
  reviewRequired: boolean;
  researchOn: Array<"gap" | "unknown_api" | "new_task_class">;
  budgetTokens: number;
  budgetUsd: number;
  budgetMs: number;
  onExhausted: ExhaustedAction;
  formation: "auto" | "propose" | "off";
};

export class SolvePolicy {
  readonly minStrategies: number;
  readonly maxAttempts: number;
  readonly maxSameFailure: number;
  readonly reviewRequired: boolean;
  readonly researchOn: SolvePolicyProps["researchOn"];
  readonly budgetTokens: number;
  readonly budgetUsd: number;
  readonly budgetMs: number;
  readonly onExhausted: ExhaustedAction;
  readonly formation: SolvePolicyProps["formation"];

  constructor(props: Partial<SolvePolicyProps> = {}) {
    this.minStrategies = props.minStrategies ?? 3;
    this.maxAttempts = props.maxAttempts ?? 12;
    this.maxSameFailure = props.maxSameFailure ?? 2;
    this.reviewRequired = props.reviewRequired ?? true;
    this.researchOn = props.researchOn ?? ["gap", "unknown_api", "new_task_class"];
    this.budgetTokens = props.budgetTokens ?? 200_000;
    this.budgetUsd = props.budgetUsd ?? 5;
    this.budgetMs = props.budgetMs ?? 30 * 60_000;
    this.onExhausted = props.onExhausted ?? "park";
    this.formation = props.formation ?? "auto";

    if (this.minStrategies < 1) throw new InvariantError("minStrategies must be >= 1");
    if (this.maxAttempts < this.minStrategies) {
      throw new InvariantError("maxAttempts must be >= minStrategies");
    }
  }

  toJSON(): SolvePolicyProps {
    return {
      minStrategies: this.minStrategies,
      maxAttempts: this.maxAttempts,
      maxSameFailure: this.maxSameFailure,
      reviewRequired: this.reviewRequired,
      researchOn: [...this.researchOn],
      budgetTokens: this.budgetTokens,
      budgetUsd: this.budgetUsd,
      budgetMs: this.budgetMs,
      onExhausted: this.onExhausted,
      formation: this.formation,
    };
  }
}
