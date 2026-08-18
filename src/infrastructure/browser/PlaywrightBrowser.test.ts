import { normalizeUrl } from "./PlaywrightBrowser.ts";

if (normalizeUrl("example.com") !== "https://example.com/") throw new Error(normalizeUrl("example.com"));
if (normalizeUrl("http://127.0.0.1:7331/x") !== "http://127.0.0.1:7331/x") throw new Error("local");
try {
  normalizeUrl("file:///etc/passwd");
  throw new Error("file allowed");
} catch (err) {
  if (!(err instanceof Error) || !/http/.test(err.message)) throw err;
}
console.log("browser url ok");
