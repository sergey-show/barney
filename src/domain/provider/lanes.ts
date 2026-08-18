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
  const large = pick(bindings, "coder", SLOW_ROLES);
  const small = pick(bindings, "reviewer", FAST_ROLES);
  return {
    large: large ? { providerId: large.providerId, model: large.model } : null,
    small: small ? { providerId: small.providerId, model: small.model } : null,
  };
}

function pick(bindings: RoleBinding[], preferred: Role, group: readonly Role[]): RoleBinding | undefined {
  return bindings.find((item) => item.role === preferred)
    ?? bindings.find((item) => (group as readonly string[]).includes(item.role));
}
