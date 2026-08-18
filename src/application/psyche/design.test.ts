import { expect, test } from "bun:test";
import {
  canonDraft,
  confirmDesign,
  constitutionFromDesign,
  isDesignGoal,
  isDesignSealed,
  isPersonaConstitution,
  parseDesignAnswers,
  samostFromDesign,
} from "./design.ts";

test("canon shortcut and numbered answers form an instance, not a persona", () => {
  const canon = parseDesignAnswers("канон");
  expect(canon.compass).toContain("Do not change the kernel");
  expect(constitutionFromDesign(canon)).not.toMatch(/^you are/i);
  expect(isDesignSealed("# Instance designed\n")).toBe(true);
  expect(isPersonaConstitution("You are Barney, a self-extending agent.")).toBe(true);
  expect(isDesignGoal("Instance self-knowledge")).toBe(true);

  const draft = parseDesignAnswers(`
1. Задачи Сергея по дому и железу. Результат — конкретный артефакт.
2. упрямый, честный
3. не собеседник
4. ru
5. обрезает URL
6. barney
`);
  expect(draft.compass).toContain("Сергея");
  expect(draft.character[0]).toContain("упрямый");
  expect(draft.never.some((line) => /kernel is immutable/i.test(line))).toBe(true);
  expect(draft.name).toBe("Barney");
  expect(parseDesignAnswers("6. rex\n1. дом").name).toBe("Barney");
  expect(constitutionFromDesign(draft)).toContain("Barney");
  expect(constitutionFromDesign(draft)).not.toMatch(/^you are/i);
  expect(samostFromDesign(draft).light.some((line) => /dedication/i.test(line))).toBe(true);
  expect(confirmDesign(canonDraft())).toContain("not a biography");
});
