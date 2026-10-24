import type { RoleBinding } from "./LlmProvider.ts";
import { FAST_ROLES, SLOW_ROLES, type Role } from "./Role.ts";

export type LaneName = "large" | "small";

export type LanePick = {
  providerId: string;
  model: string;
};

export type Lanes = {
  large: LanePick | null;
  small: LanePick | null;
};

export function rolesForLane(lane: LaneName): readonly Role[] {
  return lane === "small" ? FAST_ROLES : SLOW_ROLES;
}

export function lanesFromBindings(bindings: RoleBinding[]): Lanes {
  const coder = bindings.find((item) => item.role === "coder") ?? bindings[0];
  const large = coder ? { providerId: coder.providerId, model: coder.model } : null;
  const fast =
    bindings.find((item) => item.role === "planner")
    ?? bindings.find((item) => item.role === "reviewer");
  const small =
    fast && large && (fast.providerId !== large.providerId || fast.model !== large.model)
      ? { providerId: fast.providerId, model: fast.model }
      : null;
  return { large, small };
}
