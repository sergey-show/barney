import { InvariantError } from "../shared/DomainError.ts";
import { newId } from "../shared/Id.ts";

export type EpisodeOutcome = "success" | "partial" | "fail";

export type EpisodeProps = {
  id?: string;
  agentId: string;
  runId: string;
  taskClass: string;
  goal: string;
  outcome: EpisodeOutcome;
  failureMode?: string | null;
  capabilitiesUsed: string[];
  capabilitiesCreated: string[];
  markers: string[];
  nextHint: string;
  worktreeRef?: string;
  tokens: number;
  usd: number;
  createdAt?: string;
};

export class Episode {
  readonly id: string;
  readonly agentId: string;
  readonly runId: string;
  readonly taskClass: string;
  readonly goal: string;
  readonly outcome: EpisodeOutcome;
  readonly failureMode: string | null;
  readonly capabilitiesUsed: string[];
  readonly capabilitiesCreated: string[];
  readonly markers: string[];
  readonly nextHint: string;
  readonly worktreeRef: string;
  readonly tokens: number;
  readonly usd: number;
  readonly createdAt: string;

  constructor(props: EpisodeProps) {
    if (!props.goal.trim()) throw new InvariantError("episode goal is required");
    if (props.outcome !== "fail" && props.capabilitiesUsed.length === 0 && props.outcome === "success") {
      throw new InvariantError("successful episode must record capabilities_used");
    }
    if (props.outcome === "fail" && !props.failureMode) {
      throw new InvariantError("failed episode must have failure_mode");
    }
    this.id = props.id ?? newId("ep");
    this.agentId = props.agentId;
    this.runId = props.runId;
    this.taskClass = props.taskClass;
    this.goal = props.goal;
    this.outcome = props.outcome;
    this.failureMode = props.failureMode ?? null;
    this.capabilitiesUsed = [...props.capabilitiesUsed];
    this.capabilitiesCreated = [...props.capabilitiesCreated];
    this.markers = [...props.markers];
    this.nextHint = props.nextHint;
    this.worktreeRef = props.worktreeRef ?? "";
    this.tokens = props.tokens;
    this.usd = props.usd;
    this.createdAt = props.createdAt ?? new Date().toISOString();
  }
}
