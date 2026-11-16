// OAuth 2.1 for one user and two assistants. Claude and ChatGPT register themselves (dynamic client
// registration, accepted only with their own callbacks), the user signs in with a short code that God
// Mode's screen in Paseo shows, and every token is kept as a hash. A refresh token is spent on use;
// one that comes back again revokes everything issued from the same sign-in.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export type Assistant = "Claude" | "ChatGPT";
const CALLBACK_HOSTS: Record<string, Assistant> = {
  "claude.ai": "Claude",
  "claude.com": "Claude",
  "chatgpt.com": "ChatGPT",
  "chat.openai.com": "ChatGPT",
};

export const SCOPE = "god-mode";
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;
export const SIGN_IN_TTL_MS = 5 * 60_000;
export const MAX_TRIES = 5;
const PAGE_TTL_MS = 10 * 60_000;
const GRANT_TTL_MS = 5 * 60_000;
// A registration nobody signed in with is dropped after a day: every connect attempt registers anew.
const UNUSED_CLIENT_MS = 24 * 60 * 60_000;

export type AuthMethod = "none" | "client_secret_post" | "client_secret_basic";

export interface Client {
  assistant: Assistant;
  redirectUris: string[];
  authMethod: AuthMethod;
  secretHash: string | null;
  createdAt: string;
}

export interface Token {
  kind: "access" | "refresh";
  clientId: string;
  family: string;
  scope: string;
  expiresAt: number;
  used?: boolean;
}

/** One sign-in: the tokens issued from it and their refreshes. */
export interface Family {
  clientId: string;
  assistant: Assistant;
  createdAt: string;
  lastUsedAt: string;
}

export interface OAuthState {
  clients: Record<string, Client>;
  tokens: Record<string, Token>;
  families: Record<string, Family>;
}

export interface Connection {
  id: string;
  assistant: Assistant;
  connectedAt: string;
  lastUsedAt: string;
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

interface Page {
  clientId: string;
  redirectUri: string;
  state: string | undefined;
  challenge: string;
  scope: string;
  expiresAt: number;
}

export const emptyState = (): OAuthState => ({ clients: {}, tokens: {}, families: {} });

const sha = (value: string) => createHash("sha256").update(value).digest("base64url");
const random = (bytes = 32) => randomBytes(bytes).toString("base64url");
const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Which assistant a callback belongs to, or null for anything else. */
export function assistantFor(uri: string): Assistant | null {
  try {
    const url = new URL(uri);
    return url.protocol === "https:" ? (CALLBACK_HOSTS[url.hostname] ?? null) : null;
  } catch {
    return null;
  }
}

export class OAuth {
  private signIn: { code: string; expiresAt: number; tries: number } | null = null;
  private readonly pages = new Map<string, Page>();
  private readonly grants = new Map<string, Page>();
  private readonly state: OAuthState;
  private readonly save: (state: OAuthState) => void;
  private readonly now: () => number;

  constructor(state: OAuthState, save: (state: OAuthState) => void, now: () => number = Date.now) {
    this.state = state;
    this.save = save;
    this.now = now;
  }

  /** A fresh sign-in code for the screen in Paseo. It replaces the previous one. */
  newCode(): { code: string; expiresAt: string } {
    const code = String(randomInt(10_000_000, 100_000_000));
    this.signIn = { code, expiresAt: this.now() + SIGN_IN_TTL_MS, tries: 0 };
    return { code, expiresAt: new Date(this.signIn.expiresAt).toISOString() };
  }

  register(meta: unknown): Reply {
    const body = (meta ?? {}) as { redirect_uris?: unknown; token_endpoint_auth_method?: unknown };
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
    const assistants = new Set(uris.map(assistantFor));
    if (!uris.length || assistants.has(null) || assistants.size !== 1) {
      return { status: 400, body: { error: "invalid_redirect_uri", error_description: "Only Claude's and ChatGPT's callbacks are accepted." } };
    }
    const assistant = [...assistants][0] as Assistant;
    const asked = String(body.token_endpoint_auth_method ?? "none");
    const authMethod: AuthMethod = asked === "client_secret_post" || asked === "client_secret_basic" ? asked : "none";
    const secret = authMethod === "none" ? null : random();
    const id = `gm_${random(12)}`;
    this.dropUnusedClients();
    this.state.clients[id] = { assistant, redirectUris: uris, authMethod, secretHash: secret ? sha(secret) : null, createdAt: new Date(this.now()).toISOString() };
    this.save(this.state);
    return {
      status: 201,
      body: {
        client_id: id,
        client_id_issued_at: Math.floor(this.now() / 1000),
        ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
        client_name: assistant,
        redirect_uris: uris,
        token_endpoint_auth_method: authMethod,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: SCOPE,
      },
    };
  }

  /** The sign-in page for an authorization request, or why there is none. */
  openPage(query: Record<string, string | undefined>): { pageId: string; assistant: Assistant; host: string } | { error: string } {
    const client = query.client_id ? this.state.clients[query.client_id] : undefined;
    if (!client) return { error: "This connection is not registered. Remove it in the app and add it again." };
    if (!query.redirect_uri || !client.redirectUris.includes(query.redirect_uri)) return { error: "This callback was not registered for the connection." };
    if (query.response_type !== "code" || !query.code_challenge || (query.code_challenge_method ?? "S256") !== "S256") {
      return { error: "The request needs response_type=code and an S256 PKCE challenge." };
    }
    const pageId = random(16);
    this.pages.set(pageId, {
      clientId: query.client_id as string,
      redirectUri: query.redirect_uri,
      state: query.state,
      challenge: query.code_challenge,
      scope: query.scope || SCOPE,
      expiresAt: this.now() + PAGE_TTL_MS,
    });
    return { pageId, assistant: client.assistant, host: new URL(query.redirect_uri).hostname };
  }

  pageInfo(pageId: string): { assistant: Assistant; host: string } | null {
    const page = this.pages.get(pageId);
    if (!page || page.expiresAt < this.now()) return null;
    const client = this.state.clients[page.clientId];
    return client ? { assistant: client.assistant, host: new URL(page.redirectUri).hostname } : null;
  }

  /** The code the user typed: on success, where to send the browser back with an authorization code. */
  submitCode(pageId: string, code: string, issuer: string): { redirect: string } | { error: string; again: boolean } {
    const page = this.pages.get(pageId);
    if (!page || page.expiresAt < this.now()) return { error: "This page expired. Start connecting again.", again: false };
    const signIn = this.signIn;
    if (!signIn || signIn.expiresAt < this.now()) return { error: "No sign-in code is open. Press Connect in God Mode in Paseo for a new one.", again: true };
    if (signIn.tries >= MAX_TRIES) return { error: "Too many wrong codes. Press Connect in God Mode in Paseo for a new one.", again: true };
    if (!same(code.replace(/\D/g, ""), signIn.code)) {
      signIn.tries += 1;
      const left = MAX_TRIES - signIn.tries;
      return { error: left > 0 ? `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.` : "Wrong code. Press Connect in God Mode in Paseo for a new one.", again: true };
    }
    this.signIn = null;
    this.pages.delete(pageId);
    const grant = random();
    this.grants.set(sha(grant), { ...page, expiresAt: this.now() + GRANT_TTL_MS });
    const back = new URL(page.redirectUri);
    back.searchParams.set("code", grant);
    if (page.state !== undefined) back.searchParams.set("state", page.state);
    back.searchParams.set("iss", issuer);
    return { redirect: back.toString() };
  }

  token(form: Record<string, string | undefined>, basic?: { id: string; secret: string }): Reply {
    const clientId = basic?.id ?? form.client_id ?? "";
    const secret = basic?.secret ?? form.client_secret;
    const client = this.state.clients[clientId];
    if (!client || (client.secretHash && !(secret && same(sha(secret), client.secretHash)))) return { status: 401, body: { error: "invalid_client" } };
    if (form.grant_type === "authorization_code") {
      const key = sha(form.code ?? "");
      const grant = this.grants.get(key);
      if (!grant || grant.expiresAt < this.now() || grant.clientId !== clientId) return { status: 400, body: { error: "invalid_grant" } };
      if (form.redirect_uri && form.redirect_uri !== grant.redirectUri) return { status: 400, body: { error: "invalid_grant", error_description: "redirect_uri mismatch" } };
      if (sha(form.code_verifier ?? "") !== grant.challenge) return { status: 400, body: { error: "invalid_grant", error_description: "PKCE verification failed" } };
      this.grants.delete(key);
      const family = random(9);
      const at = new Date(this.now()).toISOString();
      this.state.families[family] = { clientId, assistant: client.assistant, createdAt: at, lastUsedAt: at };
      return this.issue(clientId, grant.scope, family);
    }
    if (form.grant_type === "refresh_token") {
      const record = this.state.tokens[sha(form.refresh_token ?? "")];
      if (!record || record.kind !== "refresh" || record.clientId !== clientId || record.expiresAt < this.now()) return { status: 400, body: { error: "invalid_grant" } };
      if (record.used) {
        this.revoke(record.family);
        return { status: 400, body: { error: "invalid_grant" } };
      }
      record.used = true;
      return this.issue(clientId, record.scope, record.family);
    }
    return { status: 400, body: { error: "unsupported_grant_type" } };
  }

  /** Who an access token belongs to, or null. */
  authenticate(bearer: string): { assistant: Assistant; family: string } | null {
    const record = this.state.tokens[sha(bearer)];
    if (!record || record.kind !== "access" || record.expiresAt < this.now()) return null;
    const family = this.state.families[record.family];
    if (!family) return null;
    family.lastUsedAt = new Date(this.now()).toISOString();
    return { assistant: family.assistant, family: record.family };
  }

  connections(): Connection[] {
    return Object.entries(this.state.families)
      .map(([id, f]) => ({ id, assistant: f.assistant, connectedAt: f.createdAt, lastUsedAt: f.lastUsedAt }))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  }

  /** Signs out one connection, or every one with "all". */
  revoke(id: string): void {
    const families = id === "all" ? Object.keys(this.state.families) : [id];
    for (const family of families) {
      for (const [key, token] of Object.entries(this.state.tokens)) if (token.family === family) delete this.state.tokens[key];
      delete this.state.families[family];
    }
    if (id === "all") this.state.clients = {};
    this.save(this.state);
  }

  /** Persists last-used times; the gateway calls it now and then rather than on every request. */
  flush(): void {
    this.save(this.state);
  }

  private issue(clientId: string, scope: string, family: string): Reply {
    const access = random();
    const refresh = random();
    const now = this.now();
    this.state.tokens[sha(access)] = { kind: "access", clientId, family, scope, expiresAt: now + ACCESS_TTL_MS };
    this.state.tokens[sha(refresh)] = { kind: "refresh", clientId, family, scope, expiresAt: now + REFRESH_TTL_MS };
    for (const [key, token] of Object.entries(this.state.tokens)) if (token.expiresAt < now) delete this.state.tokens[key];
    this.save(this.state);
    return { status: 200, body: { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh, scope } };
  }

  private dropUnusedClients(): void {
    const used = new Set(Object.values(this.state.families).map((f) => f.clientId));
    const cutoff = this.now() - UNUSED_CLIENT_MS;
    for (const [id, client] of Object.entries(this.state.clients)) {
      if (!used.has(id) && Date.parse(client.createdAt) < cutoff) delete this.state.clients[id];
    }
  }
}
