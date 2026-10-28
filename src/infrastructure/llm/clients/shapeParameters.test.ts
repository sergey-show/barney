import { expect, test } from "bun:test";
import { shapeParametersOptionalNullable } from "./openaiChat.ts";

test("optional props become type [t, null]; required stay as-is", () => {
  const shaped = shapeParametersOptionalNullable({
    type: "object",
    properties: {
      path: { type: "string", description: "file path" },
      content: { type: "string", description: "body" },
      optionalFlag: { type: "boolean", description: "maybe" },
    },
    required: ["path"],
  });
  expect(shaped.properties).toEqual({
    path: { type: "string", description: "file path" },
    content: { type: ["string", "null"], description: "body" },
    optionalFlag: { type: ["boolean", "null"], description: "maybe" },
  });
  expect(shaped.required).toEqual(["path"]);
});
