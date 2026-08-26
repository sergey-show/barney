import { expect, test } from "bun:test";
import { sealReply } from "./sealReply.ts";

test("appends a goal URL the visible reply omitted", () => {
  const sealed = sealReply("Страница открыта.", { goalAnchors: ["http://127.0.0.1:7331/"] });
  expect(sealed).toContain("http://127.0.0.1:7331/");
});

test("does not duplicate an already copied URL", () => {
  const sealed = sealReply("вот http://127.0.0.1:7331/", { goalAnchors: ["http://127.0.0.1:7331/"] });
  expect(sealed.match(/127\.0\.0\.1:7331/g)?.length).toBe(1);
});

test("appends page API when the reply used a local memo instead", () => {
  const page = "opened https://bun.sh/docs/runtime/networking/fetch\nuse AbortSignal.timeout(5000)";
  const sealed = sealReply("fetch(url, { timeout: 5000 })", {
    pageEvidence: page,
    goal: "обрыв Bun fetch timeout bun.sh",
  });
  expect(sealed).toContain("AbortSignal.timeout");
});

test("sealReply pins exact tool stdout when the model paraphrased it", () => {
  const pwd = "/dir/AI/barney_bot";
  const sealed = sealReply("сейчас где-то в проекте", { toolEvidence: [pwd] });
  expect(sealed).toContain(pwd);
});
