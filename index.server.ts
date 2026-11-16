import type { PluginServerContext } from "@getpaseo/plugin/server";
import { connectRpc, disconnectRpc, statusRpc } from "./shared/contracts.ts";
import { VERSION } from "./shared/version.ts";
import {
  getVoiceButtonRpc,
  setVoiceButtonRpc,
  shortcutRunUrl,
  voiceButtonLaunchRpc,
  voiceButtonStatusRpc,
} from "./shared/voice-button.ts";
import { Gateway } from "./server/gateway/service.ts";
import { detectVoiceHotkey, findChatGpt, isAccessibilityTrusted, launchOnMac, listShortcuts } from "./server/voice-button/mac.ts";
import { readVoiceButton, writeVoiceButton } from "./server/voice-button/settings.ts";

export default function contribute(server: PluginServerContext) {
  const gateway = new Gateway();
  // The gateway starts in the background; a failure is kept and shown on the screen.
  const started = gateway.start().catch((error) => console.log(`[god-mode] the gateway did not start: ${error?.message ?? error}`));

  server.handle(statusRpc, async () => {
    await started;
    return { version: VERSION, ...gateway.status() };
  });
  server.handle(connectRpc, async () => {
    await started;
    return gateway.connect();
  });
  server.handle(disconnectRpc, async ({ id }) => {
    await started;
    return { connections: gateway.disconnect(id) };
  });

  server.handle(getVoiceButtonRpc, async () => ({ settings: await readVoiceButton() }));
  server.handle(setVoiceButtonRpc, async ({ settings }) => ({ settings: await writeVoiceButton(settings) }));
  server.handle(voiceButtonStatusRpc, async () => {
    const mac = process.platform === "darwin";
    return {
      platform: process.platform,
      chatgpt: mac ? await findChatGpt() : null,
      accessibilityTrusted: mac ? await isAccessibilityTrusted() : null,
      detectedHotkey: mac ? detectVoiceHotkey() : null,
      shortcuts: mac ? await listShortcuts() : [],
    };
  });
  server.handle(voiceButtonLaunchRpc, async ({ client }) => {
    const settings = await readVoiceButton();
    if (client === "ios") {
      const name = settings.iosShortcutName || settings.name;
      return { outcome: "open-url" as const, via: "url" as const, needsOneTap: false, url: shortcutRunUrl(name), message: `Running the shortcut "${name}".` };
    }
    if (client === "android") {
      return { outcome: "unsupported" as const, via: "none" as const, needsOneTap: false, url: null, message: "The voice button works on Mac and iPhone." };
    }
    return launchOnMac(settings);
  });


  return () => {
    void gateway.stop();
  };
}
