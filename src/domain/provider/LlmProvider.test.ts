import { LlmProvider, normalizeOpenAiRoot } from "./LlmProvider.ts";
import { collapseSystemMessages, compatSampling, extractReasoning, parseModelIds, ThinkStreamFilter } from "../../infrastructure/llm/RoleRouter.ts";

const a = normalizeOpenAiRoot("127.0.0.1:1234");
if (a !== "http://127.0.0.1:1234/v1") throw new Error(a);
const b = normalizeOpenAiRoot("https://api.groq.com/openai/v1/");
if (b !== "https://api.groq.com/openai/v1") throw new Error(b);

const ids = parseModelIds({ data: [{ id: "llama-3" }, { id: "qwen" }] });
if (ids.join(",") !== "llama-3,qwen") throw new Error(String(ids));

const collapsed = collapseSystemMessages([
  { role: "system", content: "a" },
  { role: "system", content: "b" },
  { role: "user", content: "hi" },
]);
if (collapsed.length !== 2 || collapsed[0].role !== "system" || collapsed[0].content !== "a\n\nb") {
  throw new Error(JSON.stringify(collapsed));
}
const reasoned = extractReasoning({
  content: "<think>need date</think>\nIt is Tuesday.",
  reasoning_content: "check the clock",
});
if (reasoned.text !== "It is Tuesday.") throw new Error(reasoned.text);
if (!reasoned.thinking.includes("check the clock") || !reasoned.thinking.includes("need date")) {
  throw new Error(reasoned.thinking);
}

const streamed: string[] = [];
const filter = new ThinkStreamFilter((delta) => streamed.push(delta));
for (const chunk of ["<th", "ink>need ", "the date</th", "ink>\nTuesday"]) filter.push(chunk);
const live = filter.finish();
if (live.text !== "Tuesday") throw new Error(live.text);
if (live.thinking !== "need the date") throw new Error(live.thinking);
if (streamed.join("") !== "need the date") throw new Error(streamed.join(""));

const deepseek = extractReasoning({
  content: "It is Tuesday.",
  reasoning_content: "I will write the response now.",
});
if (deepseek.text !== "It is Tuesday.") throw new Error(deepseek.text);
if (deepseek.thinking !== "I will write the response now.") throw new Error(deepseek.thinking);

const hermes = extractReasoning({
  content: [
    "The user asked where the process is running. I should check the shell output.",
    "Wait, let me look at the model identifier again.",
    "I will reply in Russian.",
    "Ты запущен на MacBook Pro (MacBookPro10,2).",
  ].join("\n\n"),
});
if (!hermes.text.includes("Ты запущен на MacBook Pro")) throw new Error(hermes.text);
if (hermes.text.includes("I will reply")) throw new Error(hermes.text);
if (!hermes.thinking.includes("The user asked")) throw new Error(hermes.thinking);

const local = compatSampling(LlmProvider.create({ name: "local", kind: "openai-compat", host: "127.0.0.1:8080" }));
if (local.max_tokens !== 4096 || local.repeat_penalty !== 1.12 || local.dry_multiplier !== 0.8) {
  throw new Error(JSON.stringify(local));
}
const cloud = compatSampling(LlmProvider.create({ name: "groq", kind: "openai-compat", host: "https://api.groq.com/openai/v1" }));
if (cloud.repeat_penalty || cloud.dry_multiplier || cloud.presence_penalty !== 0.2) {
  throw new Error(JSON.stringify(cloud));
}
console.log("provider normalize ok");
