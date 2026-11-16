// The gateway God Mode runs inside its plugin server: an HTTP endpoint on 127.0.0.1 that Claude and
// ChatGPT reach through the tunnel, its OAuth state and call log, and the core talking to the Paseo
// daemon on this Mac. Everything it keeps lives in God Mode's data directory, private to this user.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { join } from "node:path";
import { localDaemon } from "../core/local.mjs";
import { createMcpHandler, readConfig } from "../core/mcp.mjs";
import * as ops from "../core/paseo.mjs";
import { dataDir, readJson, writeJson } from "../store.ts";
import { createCallLog } from "./calllog.ts";
import { createGatewayServer } from "./http.ts";
import { type Assistant, type Connection, OAuth, type OAuthState, emptyState } from "./oauth.ts";

export const DEFAULT_PORT = 47860;

export interface GatewayStatus {
  running: boolean;
  port: number;
  error: string | null;
  publicUrl: string | null;
  connections: Connection[];
}

/** Starts listening, retrying while a previous instance (a plugin reload) still holds the port. */
async function listen(server: Server, port: number): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/** The key confirmations are signed with: created once, kept in the data directory. */
async function readSecret(dir: string): Promise<string> {
  const file = join(dir, "secret");
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (existing.length >= 32) return existing;
  } catch {
    // First start.
  }
  const secret = randomBytes(32).toString("base64url");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(file, `${secret}\n`, { mode: 0o600 });
  return secret;
}

export class Gateway {
  readonly port: number;
  private server: Server | null = null;
  private oauth: OAuth | null = null;
  private error: string | null = null;
  private publicUrl: string | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty: OAuthState | null = null;

  constructor(port = Number(process.env.GOD_MODE_PORT) || DEFAULT_PORT) {
    this.port = port;
  }

  async start(): Promise<void> {
    try {
      const dir = dataDir();
      const state = await readJson<OAuthState>(join(dir, "oauth.json"), emptyState());
      const secret = await readSecret(dir);
      this.publicUrl = process.env.GOD_MODE_PUBLIC_URL ?? (await readJson<{ url?: string } | null>(join(dir, "tunnel.json"), null))?.url ?? null;
      const oauth = new OAuth(state, (next) => this.persist(join(dir, "oauth.json"), next));
      const log = createCallLog(join(dir, "calls.jsonl"));
      const config = readConfig({ daemon: localDaemon({ secret }) });
      const handlers = new Map<Assistant, (message: unknown) => Promise<unknown>>();
      const handlerFor = (assistant: Assistant) => {
        let handler = handlers.get(assistant);
        if (!handler) {
          handler = createMcpHandler({ config, ops, log: log.as(assistant), caller: { identified: true, assistant } }) as (message: unknown) => Promise<unknown>;
          handlers.set(assistant, handler);
        }
        return handler;
      };
      const server = createGatewayServer(
        {
          oauth,
          publicUrl: () => this.publicUrl,
          mcp: (message, assistant) => handlerFor(assistant)(message),
          note: (line) => console.log(`[god-mode] ${line}`),
        },
        this.port,
      );
      await listen(server, this.port);
      this.server = server;
      this.oauth = oauth;
      this.error = null;
      // Last-used times change on every call; they are written once a minute, not per request.
      this.flushTimer = setInterval(() => oauth.flush(), 60_000);
      this.flushTimer.unref();
    } catch (error) {
      this.error = String((error as Error)?.message ?? error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.oauth?.flush();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await this.writing;
  }

  status(): GatewayStatus {
    return { running: Boolean(this.server), port: this.port, error: this.error, publicUrl: this.publicUrl, connections: this.oauth?.connections() ?? [] };
  }

  /** A sign-in code for connecting an assistant, with the address to paste. */
  connect(): { url: string | null; code: string; expiresAt: string } {
    if (!this.oauth) throw new Error(this.error ?? "God Mode's gateway is not running.");
    return { url: this.publicUrl ? `${this.publicUrl}/mcp` : null, ...this.oauth.newCode() };
  }

  disconnect(id: string): Connection[] {
    if (!this.oauth) throw new Error(this.error ?? "God Mode's gateway is not running.");
    this.oauth.revoke(id);
    return this.oauth.connections();
  }

  /** The tunnel's public address, once it exists. */
  setPublicUrl(url: string | null): void {
    this.publicUrl = url;
  }

  /** Writes the latest state after the write in flight, so writes never overlap or reorder. */
  private persist(file: string, state: OAuthState): void {
    const pending = this.dirty !== null;
    this.dirty = state;
    if (pending) return;
    this.writing = this.writing.then(async () => {
      const next = this.dirty;
      this.dirty = null;
      if (next) await writeJson(file, next).catch((error) => console.log(`[god-mode] could not save the OAuth state: ${error?.message ?? error}`));
    });
  }
}
