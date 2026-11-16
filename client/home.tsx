import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { type AssistantName, type ConnectionView, connectRpc, disconnectRpc, statusRpc } from "../shared/contracts.ts";
import { VoiceButtonStep } from "./voice-button-section.tsx";

const STATUS_KEY = ["god-mode", "status"];

const STEPS: Record<AssistantName, string> = {
  Claude: "In Claude: Settings → Connectors → Add custom connector. Paste the address, add it, press Connect and enter the code.",
  ChatGPT: "On chatgpt.com: Plugins → Add → Add custom MCP server. Paste the address as the Server URL with OAuth, create it and enter the code.",
};

const errorText = (error: unknown) => String((error as Error)?.message ?? error);

function ago(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** The God Mode screen behind the sidebar row: connect Claude or ChatGPT, see and end connections. */
export function HomeScreen({ theme }: PluginSurfaceProps) {
  const status = useRpc(statusRpc);
  const query = useQuery({ queryKey: STATUS_KEY, queryFn: () => status({}), refetchInterval: 10_000 });
  const data = query.data;
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 22 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 30, fontWeight: "800", letterSpacing: -0.6 }}>God Mode</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 15 }}>Talk to Claude or ChatGPT. Every Paseo agent obeys.</Text>
      </View>
      <SettingsSection title="This Mac">
        <SettingsCard>
          {query.isError ? (
            <SettingsRow label="God Mode does not answer" error={errorText(query.error)} />
          ) : (
            <>
              <SettingsRow label="God Mode" hint={data?.error ?? (data ? `Version ${data.version}` : undefined)}>
                <Text style={{ color: data?.running ? theme.colors.statusSuccess : theme.colors.statusDanger, fontWeight: "600" }}>
                  {!data ? "…" : data.running ? "Running" : "Stopped"}
                </Text>
              </SettingsRow>
              <SettingsRow label="Address" hint={data?.publicUrl ?? "Not set up yet."} />
            </>
          )}
        </SettingsCard>
      </SettingsSection>
      <ConnectSection theme={theme} />
      <ConnectionsSection theme={theme} connections={data?.connections ?? []} />
      <VoiceButtonStep theme={theme} />
    </ScrollView>
  );
}

function ConnectSection({ theme }: { theme: PluginTheme }) {
  const toast = useToast();
  const connect = useRpc(connectRpc);
  const [assistant, setAssistant] = useState<AssistantName | null>(null);
  const start = useMutation({ mutationFn: () => connect({}) });
  const open = (name: AssistantName) => {
    setAssistant(name);
    start.mutate();
  };
  const copy = async (text: string, what: string) => {
    await copyText(text);
    toast.show(`${what} copied`);
  };
  return (
    <SettingsSection title="Connect">
      <SettingsCard>
        <SettingsAction label="Claude" actionLabel="Connect" onPress={() => open("Claude")} />
        <SettingsAction label="ChatGPT" actionLabel="Connect" onPress={() => open("ChatGPT")} />
      </SettingsCard>
      {assistant && start.isError ? (
        <SettingsCard>
          <SettingsRow label="No code" error={errorText(start.error)} />
        </SettingsCard>
      ) : null}
      {assistant && start.data ? (
        <SettingsCard>
          <SettingsRow label={`Connect ${assistant}`} hint={STEPS[assistant]} />
          {start.data.url ? (
            <SettingsAction label="Address" hint={start.data.url} actionLabel="Copy" onPress={() => void copy(start.data.url as string, "Address")} />
          ) : (
            <SettingsRow label="Address" error="Set up the address first." />
          )}
          <SettingsAction label="Code" hint="Good for five minutes and one sign-in." actionLabel="Copy" onPress={() => void copy(start.data.code, "Code")} />
          <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 30, fontWeight: "700", letterSpacing: 6, fontVariant: ["tabular-nums"] }}>{start.data.code}</Text>
          </View>
        </SettingsCard>
      ) : null}
    </SettingsSection>
  );
}

function ConnectionsSection({ theme, connections }: { theme: PluginTheme; connections: ConnectionView[] }) {
  const client = useQueryClient();
  const disconnect = useRpc(disconnectRpc);
  const end = useMutation({
    mutationFn: (id: string) => disconnect({ id }),
    onSuccess: () => void client.invalidateQueries({ queryKey: STATUS_KEY }),
  });
  return (
    <SettingsSection title="Connected">
      <SettingsCard>
        {connections.length === 0 ? (
          <SettingsRow label="Nothing connected yet." />
        ) : (
          connections.map((c) => (
            <SettingsAction key={c.id} label={c.assistant} hint={`Used ${ago(c.lastUsedAt)}`} actionLabel="Disconnect" disabled={end.isPending} onPress={() => end.mutate(c.id)} />
          ))
        )}
        {connections.length > 1 ? <SettingsAction label="Everything" actionLabel="Disconnect all" disabled={end.isPending} onPress={() => end.mutate("all")} /> : null}
      </SettingsCard>
      {end.isError ? <Text style={{ color: theme.colors.statusDanger }}>{errorText(end.error)}</Text> : null}
    </SettingsSection>
  );
}
