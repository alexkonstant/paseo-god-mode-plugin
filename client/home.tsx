import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { openExternalUrl, useRpc } from "@getpaseo/plugin/client";
import { ScrollView, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { type AssistantName, type ConnectionView, type TunnelView, connectRpc, disconnectRpc, statusRpc, tunnelSetupRpc } from "../shared/contracts.ts";
import { VoiceButtonStep } from "./voice-button-section.tsx";

const STATUS_KEY = ["god-mode", "status"];

const ASSISTANTS: Record<AssistantName, { page: string; steps: string }> = {
  Claude: {
    page: "https://claude.ai/customize/connectors",
    steps: "Add custom connector → name it God Mode → paste the address → Add → Connect. When it asks for a code, copy it from here.",
  },
  ChatGPT: {
    page: "https://chatgpt.com/",
    steps: "Plugins → Add → Add custom MCP server → name it God Mode → Server URL: paste the address → OAuth → Create. When it asks for a code, copy it from here.",
  },
};

const errorText = (error: unknown) => String((error as Error)?.message ?? error);
const settingUp = (tunnel?: TunnelView) => tunnel !== undefined && ["installing", "signing-in", "creating"].includes(tunnel.setup.step);

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** God Mode's screen: one button for the address on Cloudflare, one each for Claude and ChatGPT. */
export function HomeScreen({ theme }: PluginSurfaceProps) {
  const status = useRpc(statusRpc);
  const query = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => status({}),
    refetchInterval: (q) => (settingUp(q.state.data?.tunnel) ? 2000 : 10_000),
  });
  const data = query.data;
  const address = data?.tunnel.url ? `${data.tunnel.url}/mcp` : null;
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 22 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 30, fontWeight: "800", letterSpacing: -0.6 }}>God Mode</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 15 }}>Talk to Claude or ChatGPT. Every Paseo agent obeys.</Text>
      </View>
      {query.isError ? (
        <SettingsCard>
          <SettingsRow label="God Mode does not answer" error={errorText(query.error)} />
        </SettingsCard>
      ) : null}
      {data && !data.running ? (
        <SettingsCard>
          <SettingsRow label="God Mode is stopped" error={data.error ?? "Reload the plugin."} />
        </SettingsCard>
      ) : null}
      <AddressSection theme={theme} tunnel={data?.tunnel} />
      <AssistantSection theme={theme} name="Claude" address={address} connections={data?.connections ?? []} />
      <AssistantSection theme={theme} name="ChatGPT" address={address} connections={data?.connections ?? []} />
      <VoiceButtonStep theme={theme} />
      {data ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, textAlign: "center" }}>God Mode {data.version}</Text> : null}
    </ScrollView>
  );
}

function AddressSection({ theme, tunnel }: { theme: PluginTheme; tunnel?: TunnelView }) {
  const client = useQueryClient();
  const begin = useRpc(tunnelSetupRpc);
  const start = useMutation({
    mutationFn: () => begin({}),
    onSuccess: (setup) => {
      if (setup.loginUrl) void openExternalUrl(setup.loginUrl);
      void client.invalidateQueries({ queryKey: STATUS_KEY });
    },
  });
  const step = tunnel?.setup.step ?? "idle";
  let body;
  if (tunnel?.url) {
    const state = tunnel.connected ? "Working" : tunnel.running ? "Connecting…" : "Stopped";
    const color = tunnel.connected ? theme.colors.statusSuccess : tunnel.running ? theme.colors.foregroundMuted : theme.colors.statusDanger;
    body = (
      <SettingsRow label={tunnel.hostname ?? tunnel.url} hint="Claude and ChatGPT reach this Mac here.">
        <Text style={{ color, fontWeight: "600" }}>{state}</Text>
      </SettingsRow>
    );
  } else if (step === "installing") {
    body = <SettingsRow label="Cloudflare" hint="Installing cloudflared…" />;
  } else if (step === "signing-in") {
    body = (
      <SettingsAction
        label="Cloudflare"
        hint="Sign in, pick your domain and press Authorize."
        actionLabel="Open again"
        onPress={() => tunnel?.setup.loginUrl && void openExternalUrl(tunnel.setup.loginUrl)}
      />
    );
  } else if (step === "creating") {
    body = <SettingsRow label="Cloudflare" hint="Creating the address…" />;
  } else {
    body = (
      <SettingsAction
        label="Cloudflare"
        hint="Needs a domain in your Cloudflare account. Press Connect, sign in, pick the domain, press Authorize."
        actionLabel={start.isPending ? "Starting…" : "Connect"}
        disabled={start.isPending}
        onPress={() => start.mutate()}
        error={tunnel?.setup.error ?? (start.isError ? errorText(start.error) : null)}
      />
    );
  }
  return (
    <SettingsSection title="Address">
      <SettingsCard>{body}</SettingsCard>
    </SettingsSection>
  );
}

function AssistantSection({ theme, name, address, connections }: { theme: PluginTheme; name: AssistantName; address: string | null; connections: ConnectionView[] }) {
  const toast = useToast();
  const client = useQueryClient();
  const connect = useRpc(connectRpc);
  const disconnect = useRpc(disconnectRpc);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const mine = connections.filter((c) => c.assistant === name);
  const { page, steps } = ASSISTANTS[name];

  const start = useMutation({
    mutationFn: () => connect({}),
    onSuccess: async (result) => {
      setCode({ code: result.code, expiresAt: result.expiresAt });
      if (result.url) {
        await copyText(result.url);
        toast.show(`Address copied. Paste it in ${name}.`);
      }
      void openExternalUrl(page);
    },
  });
  const freshCode = useMutation({
    mutationFn: () => connect({}),
    onSuccess: (result) => setCode({ code: result.code, expiresAt: result.expiresAt }),
  });
  const end = useMutation({
    mutationFn: async () => {
      for (const c of mine) await disconnect({ id: c.id });
    },
    onSuccess: () => {
      setCode(null);
      void client.invalidateQueries({ queryKey: STATUS_KEY });
    },
  });
  const copy = async (text: string, what: string) => {
    await copyText(text);
    toast.show(`${what} copied`);
  };

  if (mine.length > 0) {
    return (
      <SettingsSection title={name}>
        <SettingsCard>
          <SettingsAction
            label={`${name} · connected`}
            hint={`Used ${ago(mine[0]?.lastUsedAt ?? new Date().toISOString())}`}
            actionLabel={end.isPending ? "Disconnecting…" : "Disconnect"}
            disabled={end.isPending}
            onPress={() => end.mutate()}
            error={end.isError ? errorText(end.error) : null}
          />
        </SettingsCard>
      </SettingsSection>
    );
  }
  const expired = code ? Date.parse(code.expiresAt) < Date.now() : false;
  return (
    <SettingsSection title={name}>
      <SettingsCard>
        <SettingsAction
          label={`Connect ${name}`}
          hint={address ? `Opens ${name} and copies the address.` : "Set up the address first."}
          actionLabel={start.isPending ? "…" : "Connect"}
          disabled={!address || start.isPending}
          onPress={() => start.mutate()}
          error={start.isError ? errorText(start.error) : null}
        />
        {code && address ? (
          <>
            <SettingsRow label="What to do" hint={steps} />
            <SettingsAction label="Address" hint={address} actionLabel="Copy" onPress={() => void copy(address, "Address")} />
            <SettingsAction
              label="Code"
              hint={expired ? "Expired. Get a new one." : "Good for five minutes and one sign-in."}
              actionLabel={expired ? "New code" : "Copy"}
              onPress={() => (expired ? freshCode.mutate() : void copy(code.code, "Code"))}
            />
            {!expired ? (
              <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
                <Text style={{ color: theme.colors.foreground, fontSize: 30, fontWeight: "700", letterSpacing: 6, fontVariant: ["tabular-nums"] }}>{code.code}</Text>
              </View>
            ) : null}
          </>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
