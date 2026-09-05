import { expect, test } from "bun:test";
import {
  autoApproveOutside,
  escapeDeniedMessage,
  pathAllowedByGrants,
  permissionGrantedMessage,
  permissionPrefix,
} from "./outsideAccess.ts";

test("permissionPrefix grants the parent directory for files", () => {
  expect(permissionPrefix("/etc/nginx/conf.d/benchmark-site.conf")).toBe("/etc/nginx/conf.d");
  expect(permissionPrefix("/etc/nginx/nginx.conf")).toBe("/etc/nginx");
  expect(permissionPrefix("/var/www/html/")).toBe("/var/www/html");
  expect(permissionPrefix("/tmp")).toBe("/tmp");
});

test("pathAllowedByGrants matches prefix and children", () => {
  const grants = ["/etc/nginx"];
  expect(pathAllowedByGrants("/etc/nginx/nginx.conf", grants)).toBe(true);
  expect(pathAllowedByGrants("/etc/nginx/conf.d/x.conf", grants)).toBe(true);
  expect(pathAllowedByGrants("/etc/hosts", grants)).toBe(false);
  expect(pathAllowedByGrants("/etc/nginx", grants)).toBe(true);
});

test("autoApproveOutside reads the env flag", () => {
  expect(autoApproveOutside({ BARNEY_AUTO_APPROVE_OUTSIDE: "1" })).toBe(true);
  expect(autoApproveOutside({ BARNEY_AUTO_APPROVE_OUTSIDE: "true" })).toBe(true);
  expect(autoApproveOutside({ BARNEY_AUTO_APPROVE_OUTSIDE: "0" })).toBe(false);
  expect(autoApproveOutside({})).toBe(false);
});

test("denied message names the allow prefix", () => {
  const msg = escapeDeniedMessage("/etc/nginx/conf.d/site.conf");
  expect(msg).toContain("permission required");
  expect(msg).toContain("/allow /etc/nginx/conf.d");
  expect(msg).toContain("BARNEY_AUTO_APPROVE_OUTSIDE");
  expect(permissionGrantedMessage("/etc/nginx", "user")).toContain("/etc/nginx");
});
