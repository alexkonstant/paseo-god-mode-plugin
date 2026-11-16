// Where the Paseo daemon on this Mac listens, and the credential it admits local clients with.
// Both are read on every call: a restarted daemon may move to another port or rotate the credential.
// Neither is ever logged.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_URL = "ws://127.0.0.1:6767/ws";

export function paseoHome(env = process.env) {
  return env.PASEO_HOME || join(homedir(), ".paseo");
}

// The daemon's "listen" from its lock file, else PASEO_LISTEN (a daemon started with it writes
// "listen": null), else the default port. A unix socket is out of reach for a WebSocket client.
export function daemonUrl(env = process.env) {
  let listen = "";
  try {
    listen = JSON.parse(readFileSync(join(paseoHome(env), "paseo.pid"), "utf8")).listen ?? "";
  } catch {
    // No lock file or an unreadable one: the daemon is starting or stopped.
  }
  if (typeof listen !== "string" || listen === "") listen = env.PASEO_LISTEN ?? "";
  const value = listen.trim().replace(/^tcp:\/\//, "");
  if (value === "") return DEFAULT_URL;
  if (value.startsWith("unix://") || value.startsWith("/")) return null;
  const port = /^\d{1,5}$/.test(value) ? value : /:(\d{1,5})$/.exec(value)?.[1];
  return port ? `ws://127.0.0.1:${port}/ws` : DEFAULT_URL;
}

export function localCredential(env = process.env) {
  try {
    const token = readFileSync(join(paseoHome(env), "local-credential"), "utf8").trim();
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

// What paseo.mjs connects with: the daemon on this Mac, and the secret confirmations are signed with.
export function localDaemon({ secret, env = process.env }) {
  return { url: () => daemonUrl(env), credential: () => localCredential(env), secret };
}
