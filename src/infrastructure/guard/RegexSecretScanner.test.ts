import { expect, test } from "bun:test";
import { GuardPolicy } from "../../domain/guard/GuardPolicy.ts";
import { MemoryVault } from "./MemoryVault.ts";
import { RegexSecretScanner } from "./RegexSecretScanner.ts";

function scan(text: string, path?: string) {
  const vault = new MemoryVault();
  const scanner = new RegexSecretScanner(new GuardPolicy(), vault);
  return { ...scanner.scan(text, path), vault };
}

test("credential assignment masks the value and keeps the name", () => {
  const secret = "D4w8z9wKN1aVeT3BpQj6kIuN7wH8X0M9KfV5OqzF";
  const masked = scan(`export AWS_SECRET_ACCESS_KEY=${secret}`);
  expect(masked.text).not.toContain(secret);
  expect(masked.text).toContain("AWS_SECRET_ACCESS_KEY=");
  expect(masked.text).toMatch(/AWS_SECRET_ACCESS_KEY=DETECTED_SECRET_CREDENTIAL_[A-F0-9]+/);
  expect(masked.vault.reveal(masked.text)).toContain(secret);
});

test("assignment still works when quotes or brackets sit between name and value", () => {
  const key = "AKIA1234567890123456";
  const masked = scan(`os.environ["AWS_ACCESS_KEY_ID"] = "${key}"`);
  expect(masked.text).not.toContain(key);
  expect(masked.text).toContain("AWS_ACCESS_KEY_ID");
  expect(masked.text).toMatch(/DETECTED_SECRET_CREDENTIAL_[A-F0-9]+/);
  expect(masked.text).not.toContain("DETECTED_SECRET_DETECTED_SECRET");
  expect((masked.text.match(/DETECTED_SECRET_/g) ?? []).length).toBe(1);
});

test("user placeholders and example allowlist tokens stay visible", () => {
  const already = scan("AWS_ACCESS_KEY_ID=<your-aws-access-key-id>");
  expect(already.text).toContain("<your-aws-access-key-id>");
  expect(already.text).not.toContain("DETECTED_SECRET_");
  const allowed = scan("token=ghp_example");
  expect(allowed.text).toContain("ghp_example");
});

test("same value gets the same token so sed can round-trip", () => {
  const key = "AKIA1234567890123456";
  const vault = new MemoryVault();
  const scanner = new RegexSecretScanner(new GuardPolicy(), vault);
  const first = scanner.scan(`token=${key}`).text;
  const second = scanner.scan(`export AWS_ACCESS_KEY_ID=${key}`).text;
  const token = first.match(/DETECTED_SECRET_[A-Z0-9_]+/)?.[0];
  expect(token).toBeTruthy();
  expect(second).toContain(token!);
  const command = `sed -i 's/${token}/<your-aws-access-key-id>/g' file`;
  expect(vault.reveal(command)).toContain(key);
  expect(vault.reveal(command)).not.toContain(token!);
});

test("entropy masks a long opaque token, not the KEY= prefix", () => {
  const secret = "D4w8z9wKN1aVeT3BpQj6kIuN7wH8X0M9KfV5OqzF";
  const line = `- echo 'export NOT_A_BINDING=${secret}' >> ~/.bashrc`;
  const masked = scan(line);
  expect(masked.text).not.toContain(secret);
  expect(masked.text).toContain("NOT_A_BINDING=");
  expect(masked.text).toMatch(/NOT_A_BINDING=DETECTED_SECRET_HIGH_ENTROPY_[A-F0-9]+/);
  expect(masked.text).not.toMatch(/export DETECTED_SECRET_/);
});

test("a non-credential assignment is left alone", () => {
  const line = "timeout=100000000 retry_count=99999999";
  expect(scan(line).text).toBe(line);
});

test("URI userinfo, JWT, and PEM are masked by shape", () => {
  const uri = scan("postgres://app:s3cret-pass@db.internal/app");
  expect(uri.text).not.toContain("app:s3cret-pass");
  expect(uri.text).toContain("postgres://");
  expect(uri.text).toMatch(/DETECTED_SECRET_URI_SECRET_[A-F0-9]+@db\.internal/);

  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.signaturebyteshere";
  const jwtMasked = scan(`Authorization: Bearer ${jwt}`);
  expect(jwtMasked.text).not.toContain(jwt);
  expect(jwtMasked.text).toMatch(/DETECTED_SECRET_JWT_[A-F0-9]+/);

  const pem = "-----BEGIN PRIVATE KEY-----\nMIIHideMeNow\n-----END PRIVATE KEY-----";
  const pemMasked = scan(pem);
  expect(pemMasked.text).not.toContain("MIIHideMeNow");
  expect(pemMasked.text).toMatch(/DETECTED_SECRET_PEM_[A-F0-9]+/);
});
