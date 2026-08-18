import { Id, newId } from "../shared/Id.ts";

export class RunId extends Id {
  static create(value = newId("run")): RunId {
    return new RunId(value);
  }
}
