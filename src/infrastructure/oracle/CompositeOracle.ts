/**
 * Routes by ExpectationMatrix.domain to the right OraclePort.
 */

import type { ExpectationMatrix, OracleVerdict } from "../../domain/oracle/Oracle.ts";
import type { OraclePort } from "../../application/ports.ts";
import { TextAnalyticsOracle } from "./TextAnalyticsOracle.ts";
import { JsonSchemaOracle } from "./JsonSchemaOracle.ts";

export class CompositeOracle implements OraclePort {
  constructor(
    private readonly text: OraclePort = new TextAnalyticsOracle(),
    private readonly json: OraclePort = new JsonSchemaOracle(),
  ) {}

  verify(artifact: string, expectations: ExpectationMatrix): OracleVerdict {
    if (expectations.domain === "api_contract") {
      return this.json.verify(artifact, expectations);
    }
    return this.text.verify(artifact, expectations);
  }
}
