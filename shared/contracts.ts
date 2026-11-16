// RPC contracts between God Mode's screen in Paseo and its plugin server.
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const PLUGIN_ID = "god-mode";

const assistant = z.enum(["Claude", "ChatGPT"]);
export type AssistantName = z.output<typeof assistant>;

const connection = z.object({
  id: z.string(),
  assistant,
  connectedAt: z.string(),
  lastUsedAt: z.string(),
});
export type ConnectionView = z.output<typeof connection>;

const setup = z.object({
  step: z.enum(["idle", "installing", "signing-in", "creating", "done", "failed"]),
  loginUrl: z.string().optional(),
  expiresAt: z.string().optional(),
  url: z.string().optional(),
  error: z.string().optional(),
});
export type SetupView = z.output<typeof setup>;

const tunnel = z.object({
  hostname: z.string().nullable(),
  url: z.string().nullable(),
  running: z.boolean(),
  connected: z.boolean(),
  setup,
});
export type TunnelView = z.output<typeof tunnel>;

/** Whether the gateway runs, the public address the assistants use, and who is connected. */
export const statusRpc = defineRpc({
  name: "god-mode.status",
  input: z.object({}),
  output: z.object({
    version: z.string(),
    running: z.boolean(),
    port: z.number(),
    error: z.string().nullable(),
    publicUrl: z.string().nullable(),
    connections: z.array(connection),
    tunnel,
  }),
});

/** The Cloudflare button: installs cloudflared if needed and returns the sign-in link to open. */
export const tunnelSetupRpc = defineRpc({
  name: "god-mode.tunnel.setup",
  input: z.object({}),
  output: setup,
});

/** A five-minute sign-in code for connecting Claude or ChatGPT, and the address to paste there. */
export const connectRpc = defineRpc({
  name: "god-mode.connect",
  input: z.object({}),
  output: z.object({ url: z.string().nullable(), code: z.string(), expiresAt: z.string() }),
});

/** Signs out one connection, or every one with id "all". */
export const disconnectRpc = defineRpc({
  name: "god-mode.disconnect",
  input: z.object({ id: z.string() }),
  output: z.object({ connections: z.array(connection) }),
});
