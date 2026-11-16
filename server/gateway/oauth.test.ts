import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { ACCESS_TTL_MS, MAX_TRIES, OAuth, type OAuthState, SIGN_IN_TTL_MS, assistantFor, emptyState } from "./oauth.ts";

const ISSUER = "https://gm.example.com";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const CHATGPT = "https://chatgpt.com/connector_platform_oauth_redirect";

function setup() {
  let now = Date.parse("2026-11-16T12:00:00Z");
  const saved: OAuthState[] = [];
  const state = emptyState();
  const oauth = new OAuth(state, (s) => saved.push(structuredClone(s)), () => now);
  return { oauth, state, saved, advance: (ms: number) => (now += ms) };
}

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

/** Registration, the sign-in page, the code and the token exchange, as an assistant walks them. */
function connect(oauth: OAuth, redirect = CLAUDE, method = "none") {
  const registered = oauth.register({ redirect_uris: [redirect], token_endpoint_auth_method: method });
  const clientId = registered.body.client_id as string;
  const secret = registered.body.client_secret as string | undefined;
  const { verifier, challenge } = pkce();
  const page = oauth.openPage({ response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "s1" });
  assert.ok("pageId" in page);
  const { code } = oauth.newCode();
  const signed = oauth.submitCode(page.pageId, code, ISSUER);
  assert.ok("redirect" in signed);
  const grant = new URL(signed.redirect).searchParams.get("code") as string;
  const reply = oauth.token({ grant_type: "authorization_code", code: grant, redirect_uri: redirect, client_id: clientId, code_verifier: verifier, ...(secret ? { client_secret: secret } : {}) });
  return { clientId, secret, reply, redirect: signed.redirect };
}

test("callbacks name the assistant; anything else is no one", () => {
  assert.equal(assistantFor(CLAUDE), "Claude");
  assert.equal(assistantFor("https://claude.com/api/mcp/auth_callback"), "Claude");
  assert.equal(assistantFor(CHATGPT), "ChatGPT");
  assert.equal(assistantFor("http://claude.ai/api/mcp/auth_callback"), null, "https only");
  assert.equal(assistantFor("https://evil.example/cb"), null);
  assert.equal(assistantFor("not a url"), null);
});

test("registration takes only Claude's or ChatGPT's callbacks, and a secret only when asked for", () => {
  const { oauth } = setup();
  assert.equal(oauth.register({ redirect_uris: ["https://evil.example/cb"] }).status, 400);
  assert.equal(oauth.register({ redirect_uris: [CLAUDE, CHATGPT] }).status, 400, "one assistant per registration");
  assert.equal(oauth.register({}).status, 400);
  const open = oauth.register({ redirect_uris: [CLAUDE] });
  assert.equal(open.status, 201);
  assert.equal(open.body.client_name, "Claude");
  assert.equal(open.body.client_secret, undefined);
  const closed = oauth.register({ redirect_uris: [CHATGPT], token_endpoint_auth_method: "client_secret_post" });
  assert.equal(closed.body.client_name, "ChatGPT");
  assert.match(String(closed.body.client_secret), /^[A-Za-z0-9_-]{43}$/);
});

test("the sign-in page needs a registered client, its own callback and an S256 challenge", () => {
  const { oauth } = setup();
  const clientId = oauth.register({ redirect_uris: [CLAUDE] }).body.client_id as string;
  const base = { response_type: "code", client_id: clientId, redirect_uri: CLAUDE, code_challenge: "x", code_challenge_method: "S256" };
  assert.ok("error" in oauth.openPage({ ...base, client_id: "gm_nobody" }));
  assert.ok("error" in oauth.openPage({ ...base, redirect_uri: CHATGPT }));
  assert.ok("error" in oauth.openPage({ ...base, code_challenge_method: "plain" }));
  assert.ok("error" in oauth.openPage({ ...base, code_challenge: undefined }));
  const page = oauth.openPage(base);
  assert.ok("pageId" in page && page.assistant === "Claude" && page.host === "claude.ai");
});

test("the code from Paseo signs in once; wrong codes run out, and an old or missing code never works", () => {
  const { oauth, advance } = setup();
  const clientId = oauth.register({ redirect_uris: [CLAUDE] }).body.client_id as string;
  const open = () => {
    const page = oauth.openPage({ response_type: "code", client_id: clientId, redirect_uri: CLAUDE, code_challenge: "c" });
    assert.ok("pageId" in page);
    return page.pageId;
  };
  const noCode = oauth.submitCode(open(), "12345678", ISSUER);
  assert.ok("error" in noCode && /Press Connect/.test(noCode.error), "nothing works before the user asks for a code");
  const { code } = oauth.newCode();
  const page = open();
  for (let i = 1; i < MAX_TRIES; i += 1) {
    const wrong = oauth.submitCode(page, "00000000", ISSUER);
    assert.ok("error" in wrong && wrong.again);
  }
  const last = oauth.submitCode(page, "00000000", ISSUER);
  assert.ok("error" in last);
  assert.ok("error" in oauth.submitCode(page, code, ISSUER), "after the last wrong try even the right code is refused");
  const fresh = oauth.newCode();
  advance(SIGN_IN_TTL_MS + 1);
  assert.ok("error" in oauth.submitCode(open(), fresh.code, ISSUER), "a code is good for five minutes");
  const good = oauth.newCode();
  const signed = oauth.submitCode(open(), ` ${good.code.slice(0, 4)} ${good.code.slice(4)} `, ISSUER);
  assert.ok("redirect" in signed, "spaces in the typed code do not matter");
  const back = new URL(signed.redirect);
  assert.equal(`${back.origin}${back.pathname}`, CLAUDE);
  assert.equal(back.searchParams.get("iss"), ISSUER);
  assert.ok(back.searchParams.get("code"));
  assert.ok("error" in oauth.submitCode(open(), good.code, ISSUER), "and only once");
});

test("the code exchange checks the client, its secret and PKCE, and opens a connection", () => {
  const { oauth } = setup();
  const done = connect(oauth);
  assert.equal(done.reply.status, 200);
  assert.equal(done.reply.body.token_type, "Bearer");
  assert.equal(done.reply.body.expires_in, ACCESS_TTL_MS / 1000);
  assert.equal(oauth.authenticate(done.reply.body.access_token as string)?.assistant, "Claude");
  assert.deepEqual(oauth.connections().map((c) => c.assistant), ["Claude"]);
  // A confidential client must bring its secret; PKCE has to match whatever the client is.
  const registered = oauth.register({ redirect_uris: [CHATGPT], token_endpoint_auth_method: "client_secret_post" });
  const { verifier, challenge } = pkce();
  const page = oauth.openPage({ response_type: "code", client_id: registered.body.client_id as string, redirect_uri: CHATGPT, code_challenge: challenge });
  assert.ok("pageId" in page);
  const signed = oauth.submitCode(page.pageId, oauth.newCode().code, ISSUER);
  assert.ok("redirect" in signed);
  const grant = new URL(signed.redirect).searchParams.get("code") as string;
  const form = { grant_type: "authorization_code", code: grant, client_id: registered.body.client_id as string, code_verifier: verifier };
  assert.equal(oauth.token(form).status, 401, "no secret");
  assert.equal(oauth.token({ ...form, client_secret: "wrong" }).status, 401);
  assert.equal(oauth.token({ ...form, client_secret: registered.body.client_secret as string, code_verifier: "wrong" }).status, 400);
  const ok = oauth.token({ ...form, client_secret: registered.body.client_secret as string });
  assert.equal(ok.status, 200, "the grant survives a failed PKCE try only until it is used");
  assert.equal(oauth.token({ ...form, client_secret: registered.body.client_secret as string }).status, 400, "a grant is used once");
});

test("a refresh rotates; an old refresh token coming back signs that connection out", () => {
  const { oauth, advance } = setup();
  const { clientId, reply } = connect(oauth);
  const first = reply.body.refresh_token as string;
  const next = oauth.token({ grant_type: "refresh_token", refresh_token: first, client_id: clientId });
  assert.equal(next.status, 200);
  assert.notEqual(next.body.refresh_token, first);
  advance(1000);
  assert.ok(oauth.authenticate(next.body.access_token as string));
  const reused = oauth.token({ grant_type: "refresh_token", refresh_token: first, client_id: clientId });
  assert.deepEqual(reused, { status: 400, body: { error: "invalid_grant" } });
  assert.equal(oauth.authenticate(next.body.access_token as string), null, "the whole family is gone");
  assert.deepEqual(oauth.connections(), []);
  assert.equal(oauth.token({ grant_type: "refresh_token", refresh_token: next.body.refresh_token as string, client_id: clientId }).status, 400);
});

test("access tokens expire; connections are listed newest first and signed out one by one or all at once", () => {
  const { oauth, advance, state } = setup();
  const claude = connect(oauth, CLAUDE);
  advance(1000);
  const chatgpt = connect(oauth, CHATGPT);
  assert.deepEqual(oauth.connections().map((c) => c.assistant), ["ChatGPT", "Claude"]);
  oauth.authenticate(claude.reply.body.access_token as string);
  assert.deepEqual(oauth.connections().map((c) => c.assistant), ["Claude", "ChatGPT"], "last used first");
  const chatgptId = oauth.connections().find((c) => c.assistant === "ChatGPT")?.id as string;
  oauth.revoke(chatgptId);
  assert.equal(oauth.authenticate(chatgpt.reply.body.access_token as string), null);
  assert.ok(oauth.authenticate(claude.reply.body.access_token as string));
  advance(ACCESS_TTL_MS + 1);
  assert.equal(oauth.authenticate(claude.reply.body.access_token as string), null, "an hour, then a refresh");
  oauth.revoke("all");
  assert.deepEqual([oauth.connections(), Object.keys(state.tokens), Object.keys(state.clients)], [[], [], []]);
});

test("registrations nobody signed in with go after a day; tokens are stored only as hashes", () => {
  const { oauth, state, saved, advance } = setup();
  const done = connect(oauth);
  oauth.register({ redirect_uris: [CLAUDE] });
  assert.equal(Object.keys(state.clients).length, 2);
  advance(25 * 60 * 60_000);
  oauth.register({ redirect_uris: [CLAUDE] });
  assert.equal(Object.keys(state.clients).length, 2, "the unused one went, the signed-in one and the new one stay");
  assert.ok(state.clients[done.clientId]);
  const stored = JSON.stringify(saved.at(-1));
  assert.ok(!stored.includes(done.reply.body.access_token as string));
  assert.ok(!stored.includes(done.reply.body.refresh_token as string));
});
