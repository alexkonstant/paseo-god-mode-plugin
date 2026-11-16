# Operations

Updating God Mode, its logs, and what to do when something does not answer.

## Updating

Update God Mode where it was installed: in Paseo's **Settings → Plugins**, or
`paseo plugin update god-mode`. A directory install (`paseo plugin add <folder>`) runs what is in the
folder: check out the version and `paseo plugin reload god-mode`.

On every load God Mode starts its gateway and its tunnel again. Claude and ChatGPT stay connected: the
connections live in `~/.paseo/god-mode/oauth.json`, not in the plugin.

## When an assistant shows the old tools

Claude and ChatGPT keep the tool list a chat started with. After an update that adds or changes tools,
start a new chat. If a tool is still missing, or the assistant calls one that no longer exists (God
Mode answers that the app is using an outdated tool list), disconnect God Mode in the assistant and
connect it again.

## Logs

| Log | Where | What is in it |
| --- | --- | --- |
| Tool calls | `~/.paseo/god-mode/calls.jsonl`, or ask the assistant for God Mode's log (`get_logs`) | Time, assistant, tool, arguments, result or error, duration. |
| The tunnel | `~/.paseo/god-mode/tunnel/cloudflared.log` | `cloudflared`'s own output: connections to Cloudflare and their errors. |
| Sign-ins and gateway errors | Paseo's daemon log, lines starting with `[god-mode]` | Registrations, sign-ins, refused codes, failed requests. Never a token. |

## Troubleshooting

| What you see | Why, and what to do |
| --- | --- |
| The assistant cannot reach God Mode | The Mac is asleep, offline, or Paseo is not running. Keep the Mac awake while you use it. |
| The screen says God Mode is stopped | The gateway could not start, usually because another process holds 127.0.0.1:47860. The screen shows the error; free the port and reload the plugin. |
| The address shows Connecting… or Stopped | `cloudflared` cannot reach Cloudflare or keeps exiting. Read `tunnel/cloudflared.log`; God Mode retries with a growing pause. |
| Address → Connect does nothing useful | The sign-in link expired (about ten minutes) or the domain is not in that Cloudflare account. Press Connect again. |
| "Creating the address failed" | Cloudflare refused the DNS record, for example because `gm` already exists as another record. Remove that record, or rename it, and press Connect again. |
| The sign-in page says no code is open | Press Connect (or New code) on God Mode's screen, then enter the code within five minutes. |
| Claude or ChatGPT asks to connect again | The connection was disconnected, its refresh token expired after 30 idle days, or a reused refresh token signed it out. Connect it again. |
| A write answers that it is unknown whether it took effect | The request failed on the way. Read the chat before sending again. |

## Removing God Mode

Disconnect Claude and ChatGPT on God Mode's screen, remove the connector in each, remove the plugin in
Paseo, then delete the tunnel in Cloudflare (Networking → Tunnels) and the `gm` DNS record, and the
folder `~/.paseo/god-mode/`.
