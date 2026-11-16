// The gateway over real HTTP on a free port, the way Claude's and ChatGPT's backends walk it:
// 401 → discovery → registration → the sign-in page and code → PKCE token → /mcp → refresh.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createCallLog } from "./calllog.ts";
import { createGatewayServer } from "./http.ts";
import { OAuth, emptyState } from "./oauth.ts";

const PUBLIC = "https://gm.example.com";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";

async function gateway() {
  const oauth = new OAuth(emptyState(), () => {});
  const calls: { message: unknown; assistant: string }[] = [];
  const server = createGatewayServer(
    {
      oauth,
      publicUrl: () => PUBLIC,
      mcp: async (message, assistant) => {
        calls.push({ message, assistant });
        const m = message as { id?: number; method: string };
        return m.id === undefined ? null : { jsonrpc: "2.0", id: m.id, result: { method: m.method, assistant } };
      },
    },
    0,
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { oauth, calls, local, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const form = (url: string, fields: Record<string, string>, headers: Record<string, string> = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields).toString(), redirect: "manual" });

test("an assistant connects end to end, calls /mcp, refreshes, and a reused refresh signs it out", async (t) => {
  const g = await gateway();
  t.after(g.close);

  let r = await fetch(`${g.local}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) });
  assert.equal(r.status, 401);
  const www = r.headers.get("www-authenticate") ?? "";
  assert.match(www, /^Bearer resource_metadata="https:\/\/gm\.example\.com\/\.well-known\/oauth-protected-resource\/mcp", scope="god-mode"$/);

  const prm = await (await fetch(`${g.local}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.deepEqual([prm.resource, prm.authorization_servers], [`${PUBLIC}/mcp`, [PUBLIC]]);
  const as = await (await fetch(`${g.local}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual([as.issuer, as.registration_endpoint, as.code_challenge_methods_supported], [PUBLIC, `${PUBLIC}/register`, ["S256"]]);
  assert.equal(as.client_id_metadata_document_supported, undefined, "no CIMD: both assistants register");

  r = await fetch(`${g.local}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["https://evil.example/cb"] }) });
  assert.equal(r.status, 400);
  r = await fetch(`${g.local}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Claude", redirect_uris: [CLAUDE], token_endpoint_auth_method: "client_secret_post" }) });
  const client = await r.json();
  assert.equal(r.status, 201);

  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URL(`${g.local}/authorize`);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: client.client_id, redirect_uri: CLAUDE, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "xyz", resource: `${PUBLIC}/mcp` })) {
    authorize.searchParams.set(k, v);
  }
  r = await fetch(authorize);
  const pageHtml = await r.text();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.match(pageHtml, /<b>Claude<\/b> \(claude\.ai\) wants to control Paseo on your Mac/);
  const pageId = pageHtml.match(/name="page" value="([^"]+)"/)?.[1] as string;

  r = await form(`${g.local}/authorize`, { page: pageId, code: "12345678" });
  assert.equal(r.status, 401, "no code was asked for yet");
  assert.match(await r.text(), /No sign-in code is open/);
  const { code } = g.oauth.newCode();
  r = await form(`${g.local}/authorize`, { page: pageId, code });
  assert.equal(r.status, 302);
  const back = new URL(r.headers.get("location") as string);
  assert.deepEqual([back.origin + back.pathname, back.searchParams.get("state"), back.searchParams.get("iss")], [CLAUDE, "xyz", PUBLIC]);

  const exchange = { grant_type: "authorization_code", code: back.searchParams.get("code") as string, redirect_uri: CLAUDE, code_verifier: verifier };
  const basic = { authorization: `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}` };
  r = await form(`${g.local}/token`, exchange);
  assert.equal(r.status, 401, "a confidential client must authenticate");
  r = await form(`${g.local}/token`, exchange, basic);
  const tokens = await r.json();
  assert.equal(r.status, 200);

  const mcp = (token: string, body: unknown) =>
    fetch(`${g.local}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  r = await mcp(tokens.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(await r.json(), { jsonrpc: "2.0", id: 2, result: { method: "tools/list", assistant: "Claude" } });
  r = await mcp(tokens.access_token, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(r.status, 202);
  r = await mcp(tokens.access_token, [{ jsonrpc: "2.0", id: 3, method: "ping" }, { jsonrpc: "2.0", method: "notifications/x" }]);
  assert.deepEqual((await r.json()).map((m: { id: number }) => m.id), [3], "a batch answers its requests only");
  assert.equal((await fetch(`${g.local}/mcp`)).status, 405);

  r = await form(`${g.local}/token`, { grant_type: "refresh_token", refresh_token: tokens.refresh_token }, basic);
  const next = await r.json();
  assert.equal(r.status, 200);
  r = await form(`${g.local}/token`, { grant_type: "refresh_token", refresh_token: tokens.refresh_token }, basic);
  assert.equal(r.status, 400);
  r = await mcp(next.access_token, { jsonrpc: "2.0", id: 4, method: "ping" });
  assert.equal(r.status, 401, "a reused refresh token signs the connection out");
  assert.match(r.headers.get("www-authenticate") ?? "", /error="invalid_token"/);
  assert.deepEqual(g.calls.map((c) => c.assistant), ["Claude", "Claude", "Claude", "Claude"]);
});

test("a body too large is refused, and an unknown path is a 404", async (t) => {
  const g = await gateway();
  t.after(g.close);
  const big = await fetch(`${g.local}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: "x".repeat(1_100_000) });
  assert.equal(big.status, 413);
  assert.equal((await fetch(`${g.local}/nothing`)).status, 404);
});

test("the call log keeps calls per assistant and answers get_logs newest first", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "god-mode-log-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let clock = Date.parse("2026-11-16T12:00:00Z");
  const log = createCallLog(join(dir, "calls.jsonl"), () => new Date((clock += 1000)));
  const claude = log.as("Claude");
  await claude.record({ tool: "list_chats", args: "{}", ok: true, durationMs: 120, output: "3 chats", error: null });
  await log.as("ChatGPT").record({ tool: "send_message", args: '{"chat":"fleet"}', ok: false, durationMs: 40, output: "", error: "Paseo is offline" });
  const all = await claude.recent({ limit: 10, errorsOnly: false });
  assert.equal(all.split("\n")[0], '2026-11-16 12:00:02 UTC ChatGPT send_message FAILED 40 ms {"chat":"fleet"}');
  assert.match(all, /12:00:01 UTC Claude list_chats ok 120 ms \{\}\n  -> 3 chats$/);
  assert.equal((await claude.recent({ limit: 10, errorsOnly: true })).split("\n").length, 2, "one failed call, two lines");
  assert.equal(await claude.recent({ limit: 10, errorsOnly: false, tool: "read_chat" }), "No calls logged yet.");
});
