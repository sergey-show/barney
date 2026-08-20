import type { RoleBinding } from "./LlmProvider.ts";
import { ROLES, type Role } from "./Role.ts";

export type LaneName = "large" | "small";

export type LanePick = {
  providerId: string;
  model: string;
};

export type Lanes = {
  large: LanePick | null;
  small: LanePick | null;
};

export function rolesForLane(_lane: LaneName): readonly Role[] {
  return ROLES;
}

export function lanesFromBindings(bindings: RoleBinding[]): Lanes {
  const bound = bindings.find((item) => item.role === "coder") ?? bindings[0];
  const large = bound ? { providerId: bound.providerId, model: bound.model } : null;
  return { large, small: null };
}
