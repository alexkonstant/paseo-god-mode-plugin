// The HTTP side of the gateway: OAuth discovery and endpoints, the sign-in page, and /mcp, where a
// signed-in assistant's JSON-RPC goes to the core. It listens on 127.0.0.1 only; the tunnel brings
// the public address here.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { type Assistant, type OAuth, SCOPE } from "./oauth.ts";

export interface GatewayDeps {
  oauth: OAuth;
  /** The address the assistants were given, such as https://gm.example.com; null before the tunnel exists. */
  publicUrl: () => string | null;
  /** One JSON-RPC message from a signed-in assistant; null for a notification. */
  mcp: (message: unknown, assistant: Assistant) => Promise<unknown>;
  /** Sign-ins and failures, for the plugin's log. Never given a token. */
  note?: (line: string) => void;
}

const MAX_BODY = 1_000_000;

class TooLarge extends Error {}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > MAX_BODY) throw new TooLarge("body too large");
  }
  return body;
}

function parseForm(req: IncomingMessage, raw: string): Record<string, string> {
  if ((req.headers["content-type"] ?? "").includes("application/json")) {
    const value = JSON.parse(raw || "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]));
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function html(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
  });
  res.end(body);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#f2f2f2;font:16px -apple-system,system-ui,sans-serif}
main{width:min(360px,88vw)}h1{font-size:24px;letter-spacing:-.4px;margin:0 0 10px}p{color:#9a9a9a;margin:0 0 20px;line-height:1.45}b{color:#f2f2f2}
input{width:100%;box-sizing:border-box;padding:15px;font-size:26px;letter-spacing:6px;text-align:center;background:#111;color:#fff;border:1px solid #2a2a2a;border-radius:14px;outline:none}
input:focus{border-color:#ffb020}button{width:100%;margin-top:12px;padding:15px;font-size:17px;font-weight:600;background:#ffb020;color:#000;border:0;border-radius:14px}
.err{color:#ff6b6b}</style></head><body><main>${body}</main></body></html>`;
}

function signInPage(pageId: string, assistant: Assistant, host: string, error?: string) {
  return page(
    "God Mode — sign in",
    `<h1>God Mode</h1><p><b>${esc(assistant)}</b> (${esc(host)}) wants to control Paseo on your Mac.<br>Enter the code from God Mode in Paseo: Connect ${esc(assistant)}.</p>` +
      (error ? `<p class="err">${esc(error)}</p>` : "") +
      `<form method="post" action="/authorize"><input type="hidden" name="page" value="${esc(pageId)}">` +
      `<input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="00000000" autofocus required>` +
      `<button type="submit">Sign in</button></form>`,
  );
}

const messagePage = (title: string, text: string) => page(title, `<h1>${esc(title)}</h1><p>${esc(text)}</p>`);

export function createGatewayServer(deps: GatewayDeps, port: number): Server {
  const base = () => (deps.publicUrl() ?? `http://127.0.0.1:${port}`).replace(/\/$/, "");
  const resourceMetadata = () => ({
    resource: `${base()}/mcp`,
    authorization_servers: [base()],
    bearer_methods_supported: ["header"],
    scopes_supported: [SCOPE],
    resource_name: "God Mode",
  });
  const serverMetadata = () => ({
    issuer: base(),
    authorization_endpoint: `${base()}/authorize`,
    token_endpoint: `${base()}/token`,
    registration_endpoint: `${base()}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [SCOPE],
    authorization_response_iss_parameter_supported: true,
  });
  const challenge = (res: ServerResponse, invalid: boolean) =>
    json(res, 401, { error: "invalid_token", error_description: invalid ? "The access token is invalid or expired." : "Sign-in required." }, {
      "WWW-Authenticate": `Bearer resource_metadata="${base()}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"${invalid ? ', error="invalid_token"' : ""}`,
    });

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://gateway");
    const path = url.pathname;
    if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") return json(res, 200, resourceMetadata());
    if (path === "/.well-known/oauth-authorization-server" || path.startsWith("/.well-known/oauth-authorization-server/") || path === "/.well-known/openid-configuration") {
      return json(res, 200, serverMetadata());
    }
    if (path === "/register" && req.method === "POST") {
      let meta: unknown;
      try {
        meta = JSON.parse((await readBody(req)) || "{}");
      } catch (error) {
        if (error instanceof TooLarge) throw error;
        return json(res, 400, { error: "invalid_client_metadata", error_description: "A JSON body is expected." });
      }
      const reply = deps.oauth.register(meta);
      deps.note?.(reply.status === 201 ? `registered a ${reply.body.client_name} connection` : "refused a registration with a foreign callback");
      return json(res, reply.status, reply.body);
    }
    if (path === "/authorize" && req.method === "GET") {
      const opened = deps.oauth.openPage(Object.fromEntries(url.searchParams));
      if ("error" in opened) return html(res, 400, messagePage("Cannot sign in", opened.error));
      return html(res, 200, signInPage(opened.pageId, opened.assistant, opened.host));
    }
    if (path === "/authorize" && req.method === "POST") {
      const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
      const result = deps.oauth.submitCode(form.page ?? "", form.code ?? "", base());
      if ("redirect" in result) {
        deps.note?.("signed in a connection");
        res.writeHead(302, { Location: result.redirect, "Cache-Control": "no-store" });
        return res.end();
      }
      deps.note?.("a sign-in code was refused");
      const info = deps.oauth.pageInfo(form.page ?? "");
      if (result.again && info) return html(res, 401, signInPage(form.page as string, info.assistant, info.host, result.error));
      return html(res, 400, messagePage("Cannot sign in", result.error));
    }
    if (path === "/token" && req.method === "POST") {
      let form: Record<string, string>;
      try {
        form = parseForm(req, await readBody(req));
      } catch (error) {
        if (error instanceof TooLarge) throw error;
        return json(res, 400, { error: "invalid_request" });
      }
      const basic = req.headers.authorization?.match(/^Basic\s+(.+)$/i)?.[1];
      let client: { id: string; secret: string } | undefined;
      if (basic) {
        const [id = "", secret = ""] = Buffer.from(basic, "base64").toString().split(":");
        client = { id: decodeURIComponent(id), secret: decodeURIComponent(secret) };
      }
      const reply = deps.oauth.token(form, client);
      return json(res, reply.status, reply.body);
    }
    if (path === "/mcp") {
      if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" }, { Allow: "POST" });
      const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      const who = bearer ? deps.oauth.authenticate(bearer) : null;
      if (!who) return challenge(res, Boolean(bearer));
      let rpc: unknown;
      try {
        rpc = JSON.parse(await readBody(req));
      } catch (error) {
        if (error instanceof TooLarge) throw error;
        return json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
      const batch = Array.isArray(rpc) ? rpc : [rpc];
      const replies = (await Promise.all(batch.map((m) => deps.mcp(m, who.assistant)))).filter((r) => r !== null && r !== undefined);
      if (replies.length === 0) {
        res.writeHead(202);
        return res.end();
      }
      return json(res, 200, Array.isArray(rpc) ? replies : replies[0]);
    }
    if (path === "/") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("God Mode\n");
    }
    return json(res, 404, { error: "not_found" });
  }

  return createServer((req, res) => {
    route(req, res).catch((error) => {
      if (error instanceof TooLarge) {
        if (!res.headersSent) json(res, 413, { error: "too_large" });
        return;
      }
      deps.note?.(`request failed: ${String(error?.message ?? error)}`);
      if (!res.headersSent) json(res, 500, { error: "server_error" });
    });
  });
}
