import { GuardPolicy } from "../../domain/guard/GuardPolicy.ts";
import { MemoryVault } from "./MemoryVault.ts";
import { RegexSecretScanner } from "./RegexSecretScanner.ts";

const scanner = new RegexSecretScanner(new GuardPolicy(), new MemoryVault());
const masked = scanner.scan("token=ghp_abcdefghijklmnopqrstuvwxyz123456 password=supersecretvalue");
if (!masked.text.includes("{{SECRET:")) {
  throw new Error(`expected mask, got ${masked.text}`);
}
if (masked.text.includes("ghp_abcdefghijklmnopqrstuvwxyz123456")) {
  throw new Error("raw github token leaked");
}
console.log("guard ok", masked.text);
