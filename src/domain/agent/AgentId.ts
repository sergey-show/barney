import { Id, newId } from "../shared/Id.ts";

export class AgentId extends Id {
  static create(value = newId("agent")): AgentId {
    return new AgentId(value);
  }
}
