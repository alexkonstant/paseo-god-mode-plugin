# Voice button

An optional button in Paseo that opens ChatGPT's own voice chat, so you talk to ChatGPT with your
account, its memory and God Mode's tools. It is about ChatGPT's voice only. It is off until you turn
on **ChatGPT voice in Paseo** in the God Mode screen, under **Voice button**, and it never calls an
OpenAI API or sees the conversation.

## Settings

The screen has one switch, **ChatGPT voice in Paseo** (off by default): on, Paseo shows the button.
The other settings are no longer on the screen and keep their defaults:

| Setting | Default | What it does |
| --- | --- | --- |
| Name | Jarvis | The button's label and Command Center title. A plain one-word name is also its slash command (`/jarvis`); any other name uses `/voice-chat`. |
| Placements | all on | A pill in every chat, a button in every workspace header (a new chat has no pill yet), a sidebar row, a Command Center item, a slash command. |
| On a Mac | Press ChatGPT's voice shortcut | How the Mac starts voice; see below. |
| iPhone shortcut | the name | The Apple Shortcut the iPhone runs. |

Settings are kept in `~/.paseo/god-mode/voice-button.json` on the daemon's Mac. The switch changes
only whether the button is on, so a value an earlier version stored in that file stays in force.
Other devices pick up a change the next time Paseo loads the plugin.

## On a Mac

OpenAI publishes no link or API that opens ChatGPT voice, and the ChatGPT desktop app (bundle
`com.openai.codex`) has no Shortcuts action. What it has is two keyboard shortcuts, kept in
`~/.codex/keybindings.json` when changed:

- **Voice chat shortcut** (`realtimeVoice`), in ChatGPT → Settings → General. No default. Starts
  voice in a new chat from anywhere.
- **Toggle voice mode** (`composer.startVoiceMode`), in ChatGPT → Settings → Keyboard shortcuts.
  `Ctrl+Shift+V` by default. Toggles voice in the open ChatGPT chat, so a second tap ends it.

The button reads that file, prefers the global shortcut, brings ChatGPT to the front (starting it
if needed) and presses the shortcut. Pressing keys needs Paseo in System Settings → Privacy &
Security → Accessibility; the button checks that without prompting and never presses keys unless
ChatGPT is the frontmost app. Without the permission it brings ChatGPT forward and you tap its voice
button once.

The Mac actions run where the Paseo daemon runs: a browser connected to a remote daemon opens
ChatGPT on that daemon's Mac.

## On an iPhone

The button opens `shortcuts://run-shortcut?name=<name>`, Apple's
[URL scheme for running a shortcut](https://support.apple.com/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/ios).
Make a shortcut named after the button (Jarvis by default) in the Shortcuts app, holding ChatGPT's
action that starts a voice conversation. Android is not supported.
