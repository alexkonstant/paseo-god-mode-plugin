// The voice button, reduced to one switch: on, Paseo shows a button that opens ChatGPT's own voice
// chat. Everything else keeps its default: ChatGPT's own shortcut on a Mac, and on an iPhone the
// Apple Shortcut named after the button.
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { defaultVoiceButtonSettings, getVoiceButtonRpc, setVoiceButtonRpc } from "../shared/voice-button.ts";
import { publishVoiceButton } from "./voice-button.tsx";

const SETTINGS_KEY = ["god-mode", "voice-button"];
const errorText = (error: unknown) => String((error as Error)?.message ?? error);

export function VoiceButtonStep(_props: { theme: PluginTheme }) {
  const get = useRpc(getVoiceButtonRpc);
  const set = useRpc(setVoiceButtonRpc);
  const queryClient = useQueryClient();
  const loaded = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => get({}) });
  const save = useMutation({
    mutationFn: (enabled: boolean) => set({ settings: { ...(loaded.data?.settings ?? defaultVoiceButtonSettings()), enabled } }),
    onSuccess: ({ settings }) => {
      publishVoiceButton(settings);
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });
  return (
    <SettingsSection title="Voice button">
      <SettingsCard>
        <SettingsSwitch
          label="ChatGPT voice in Paseo"
          hint="A button in Paseo that opens ChatGPT's voice chat."
          value={loaded.data?.settings.enabled ?? false}
          disabled={!loaded.data || save.isPending}
          onValueChange={(value) => save.mutate(value)}
          error={loaded.isError ? errorText(loaded.error) : save.isError ? errorText(save.error) : null}
        />
        {loaded.isPending ? <SettingsRow label="Loading…" /> : null}
      </SettingsCard>
    </SettingsSection>
  );
}
