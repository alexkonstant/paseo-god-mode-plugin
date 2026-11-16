import assert from "node:assert/strict";
import { test } from "node:test";
import { configText, routedHostname } from "./cloudflared.ts";

test("the hostname comes out of what `tunnel route dns` says, new or already there", () => {
  assert.equal(routedHostname("2026-11-16T13:24:33Z INF Added CNAME gm.devxpro.net which will route to this tunnel tunnelID=5f54"), "gm.devxpro.net");
  assert.equal(routedHostname("INF gm.Example.com is already configured to route to your tunnel tunnelID=5f54"), "gm.example.com");
  assert.equal(routedHostname("ERR Failed to add route: code: 1003, reason: Failed to create record"), null);
});

test("the config publishes one hostname to the gateway and nothing else", () => {
  const text = configText("5f54a111-0000-4000-8000-000000000000", "gm.devxpro.net", 47860);
  assert.match(text, /^tunnel: 5f54a111-0000-4000-8000-000000000000$/m);
  assert.match(text, /^ {2}- hostname: gm\.devxpro\.net\n {4}service: http:\/\/127\.0\.0\.1:47860$/m);
  assert.match(text, /^ {2}- service: http_status:404$/m, "anything else is a 404");
  assert.match(text, /^no-autoupdate: true$/m);
});
