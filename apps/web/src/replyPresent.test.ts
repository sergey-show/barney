import { expect, test } from "bun:test";
import { collectSources, prepareAssistantReply, stripToolPageDump } from "./replyPresent.ts";

const sample = `## 1. Paper
[arXiv:2606.12683](https://arxiv.org/abs/2606.12683)

Обе работы указывают на системную природу.

opened https://arxiv.org/abs/2606.12683
Bibliographic Explorer (What is the Explorer?)
Connected Papers (What is Connected Papers?)
We gratefully acknowledge support from our major funders
`;

test("strips arXiv chrome after the answer", () => {
  const body = stripToolPageDump(sample);
  expect(body).toContain("arXiv:2606.12683");
  expect(body).toContain("системную природу");
  expect(body).not.toContain("Bibliographic Explorer");
  expect(body).not.toContain("opened https");
});

test("collects unique sources with readable titles", () => {
  const sources = collectSources(sample);
  expect(sources.some((item) => item.href.includes("2606.12683"))).toBe(true);
  expect(sources[0]?.title).toContain("arXiv");
  expect(sources[0]?.host).toBe("arxiv.org");
});

test("prepareAssistantReply returns clean body and sources", () => {
  const prepared = prepareAssistantReply(sample);
  expect(prepared.body).not.toContain("Connected Papers");
  expect(prepared.sources.length).toBeGreaterThan(0);
});
