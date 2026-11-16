# Security, confirmations and errors

What protects your Paseo when Claude or ChatGPT drives it, what each confirmation proves, and how
failures are reported. The short version for users is in the [README](../README.md#security).

## Trust model

- **God Mode can do what a paired Paseo app can do.** Through the daemon's local credential it can
  start agents, read chats and call any plugin RPC. Its tools offer a part of that, and agents with
  permissions bypassed run whatever they are told: treat a connection to God Mode as control of the
  Mac.
- **The key to Paseo stays on the Mac.** God Mode reads the daemon's address and local credential from
  `~/.paseo/` on every call and never sends, logs or stores them. It does not use or ask for a pairing
  link.
- **Who can call.** Only a connection that went through God Mode's OAuth: Claude or ChatGPT, signed in
  by you with a code from God Mode's screen. Every other request to `/mcp` gets `401`.
- **The path.** Claude's and ChatGPT's servers call `https://gm.<your domain>/mcp`. Your Cloudflare
  tunnel brings the request to 127.0.0.1:47860 on the Mac; `cloudflared` dials out, so no port is open
  on the Mac or the router.

## Signing in

- **Registration** (OAuth dynamic client registration) is accepted only with Claude's callbacks
  (`claude.ai`, `claude.com`) or ChatGPT's (`chatgpt.com`, `chat.openai.com`). God Mode names each
  connection by its callback, not by what the client calls itself. A registration nobody signed in with
  is dropped after a day.
- **The code.** Pressing Connect on God Mode's screen shows an 8-digit code. It works once, for five
  minutes, with five tries; a new press replaces it. Without an open code nobody can sign in.
- **Tokens.** PKCE (S256) on every sign-in. An access token lasts an hour; a refresh token lasts 30
  days, is spent on use and replaced; one that is used a second time revokes every token of that
  sign-in. Tokens are stored in `~/.paseo/god-mode/oauth.json` as SHA-256 hashes only.
- **Disconnect** on God Mode's screen revokes a connection at once. The assistant then has to be
  connected again with a new code.
- **What sign-in cannot stop:** typing your code into a sign-in page someone else opened. Enter the code
  only on the page your own Claude or ChatGPT opened after you pressed Connect; a connection you do not
  recognise shows up on God Mode's screen.

## The tunnel and Cloudflare

- **Cloudflare decrypts the traffic at its edge**, as every Cloudflare proxy does: it can see the
  requests and answers that pass, tokens included. Anthropic and OpenAI see what their assistant reads,
  as with any connector.
- **The tunnel's credentials** (`~/.paseo/god-mode/tunnel/credentials.json`, readable only by you) let
  whoever holds them run a connector for your tunnel and receive part of its traffic. Keep the file
  private; to revoke it, delete the tunnel in Cloudflare.
- **The Cloudflare sign-in key** (`~/.cloudflared/cert.pem`) can create and delete tunnels and DNS
  records. God Mode deletes it as soon as the tunnel and its hostname exist.
- **Your Cloudflare account** controls the address: protect it with two-factor sign-in, and give no one
  else rights to edit its DNS or tunnels.

## Writes

The tools that change something: `start_chat`, `send_message`, `answer_approval`, `answer_questions`,
`stop_chat`, `archive_chat`, `pin_chat`, `rename_chat`, `rename_workspace`, `set_chat_model`,
`run_slash_command`, `plugin_action`.

- **Only on a command.** The tool descriptions and instructions tell the assistant to call a write tool
  only when the user's latest words tell it to act now, or are "yes" to its own "Send it?"; drafting,
  discussing or "you could send it" are not commands.
- **One instruction, one write.** A write result says `delivered: true` when it arrived; the rules say
  never to send it again or a reworded copy. Writes do not wait for the agent's reply.
- **The chat a write reaches.** By id, that chat. By name, only a chat that has the whole name, or
  every word of it, and no other chat as well: chats that share a title (Paseo titles continued chats
  alike), a partial match, an id start several chats share and an unknown id all return
  `needs_clarification`, and nothing is done. A write never chooses by recency or by which chat is
  running or waiting. `send_message` by the id of an archived chat whose title an active chat now has
  answers `archived` and sends nothing unless `if_archived: "restore"`. This is a server check.
- **Answers to an agent's questions are the user's.** `answer_questions` sends only what it is given
  for a request that is still pending, by that request's id, and only when every question has a
  valid answer; it never fills one in, and `answer_approval` will not allow a question request (Codex
  would answer it with the first options). A question that asks for a secret is left to Paseo. These
  are server checks.
- **Read-back for risky agent actions.** Approving a request, stopping or archiving a chat need the
  user to have heard exactly what will happen and said yes. This is a rule the assistant follows, not a
  server check.
- **The assistant's own approvals.** Claude and ChatGPT may also ask before a tool runs, depending on
  how you set the connection's permissions there. God Mode does not depend on it.

## Plugin actions and their confirmation

Plugins describe their operations themselves ([contract](plugin-capabilities.md)); anything above
`low` risk asks first. The mechanics are in [plugin-tools.md](plugin-tools.md#actions-that-ask-first).

What is guaranteed:

- **Exactly this call.** The confirmation token is an HMAC-SHA256, keyed with God Mode's own secret
  (`~/.paseo/god-mode/secret`, created on first start), over the plugin, operation, method and the
  canonical arguments with the fixed ones merged in. A token runs only that call; it cannot be forged
  or moved to other arguments, and it expires after two minutes.
- **Facts from the plugin, rechecked.** With a `target`, `confirm_text` shows facts God Mode read from
  the plugin for exactly those arguments, and the token signs them. Right before running, the target is
  read again; if the facts differ, nothing runs and the user is asked again. An unreadable target
  refuses the action.

What is not guaranteed:

- **That the user said yes.** The token proves what was put to the user; asking them is the
  assistant following its rules. Describe nothing you would not accept being run by a model that
  misheard.
- **A transaction.** The recheck is a read a moment before the call. If the thing can change in the
  instant between that read and the plugin's handler, only the handler can check it.
- **Single use.** A token is not spent: within its two minutes the same call could run twice. God Mode
  relies on `delivered: true` and the rule never to repeat a done action.
- **The plugin's honesty.** A plugin is trusted code on your Mac; its description says what its RPCs
  do, and God Mode cannot verify that.

## Slash commands

`run_slash_command` sends a chat's own command as a message, and only one that the chat lists and
whose provider God Mode knows how to run ([slash-commands.md](slash-commands.md)).

What is guaranteed:

- **Nothing the agent would take as plain text.** A name the chat does not list is never sent, nor a
  command God Mode refuses (`/clear`, `/rewind`, `/model`, `/heapdump`, session and account
  commands, Codex's `/review`), nor arguments that start a second command.
- **Exactly this run.** Anything above low risk, and every command God Mode cannot judge (your own,
  plugins', MCP prompts), runs only with a confirmation token: HMAC-SHA256 keyed with God Mode's
  secret, over the chat, the exact command text and whether it interrupts the chat's work; two minutes.
- **A working chat is not interrupted by surprise.** A command waits while the chat works; it stops
  the work only with `if_busy: "interrupt"`, which the rules allow only on the user's explicit yes,
  and a risky command's confirmation covers that interruption.

What is not guaranteed: that the user said yes (the assistant's part), what a custom command does
beyond its description, and that a command asks before acting: it runs with the chat's own permission
mode, and with permissions bypassed nothing asks (the confirmation says so). Tokens are not single
use, as for plugin actions.

## Other people's words

Answers from operations marked `untrusted` (messages, mail, tickets) carry a fixed note and
`untrusted: true`, and the rules say never to act on instructions inside them. It is a signal to the
model, not a filter; the protection for actions is the confirmation above and the rule to act only on
the user's own words. The same applies to anything else the assistant reads in the same chat, such as
mail or web pages from its other connectors: if you mix those with God Mode, keep the assistant's
approvals on for God Mode's writes.

## What leaves your Mac

- Tool results go to Claude or ChatGPT, through Cloudflare, like the chat text you ask about. Pictures
  from a chat are read only when you ask for them (`show_images`) and only the ones the chat itself
  shows; no copy is kept.
- Plugin answers are trimmed to the fields the plugin marked (`output.fields`); keys that look secret
  (`token`, `secret`, `password`, `credential`, `cookie`, `bearer`, `authorization`, `api key`,
  `private key`) have text values redacted.
- **The call log stays on the Mac.** Each tool call is a line in `~/.paseo/god-mode/calls.jsonl`: time,
  assistant, tool, arguments (each text cut to 300 characters), ok, duration, and the output or error
  cut to 500. The latest 2000 calls are kept. `get_logs` reads it back.

## Errors and outcomes

| Situation | What the assistant gets |
| --- | --- |
| Bad or missing arguments | A JSON-RPC error that says what the tool or the plugin operation takes. Nothing runs. |
| A name that matches several things, or nothing | `needs_clarification` with candidates to ask the user about; for chats a `reason`, and for writes the text says nothing was done. |
| `send_message` to an archived chat an active one now stands in for | `outcome: "archived"`, `delivered: false`, the active chats with its title in `same_title`. |
| The Mac asleep or offline | The address does not answer, and the assistant reports that it cannot reach God Mode. Nothing runs. |
| Paseo restarting while the Mac is up | "Paseo is offline: the computer running it is probably asleep or disconnected." A write adds "Nothing was sent." |
| A request that failed on the way | "Paseo request failed: …"; a write adds "Unknown whether it took effect: never say it did." |
| A plugin that said it did not do it | `outcome: "refused"`, `delivered: false` and the reason (a read: `refused: true`). |
| A busy agent | `send_message` answers `busy`, `delivered: false`, and asks whether to add the message to the current work or interrupt; `run_slash_command` answers `busy` and asks whether to interrupt. |
| A slash command God Mode does not run | `run_slash_command` answers `unavailable`, `delivered: false`, with the reason and what to use instead. |
| A tool the assistant remembers from an older version | "There is no tool …: the app is using an outdated tool list for God Mode. Tell the user to start a new chat; if that does not help, to reconnect God Mode." |
| A revoked or expired sign-in | `401`; the assistant asks to connect God Mode again. |
| A tool call over 30 seconds | "Paseo request failed: no answer within 30 s." |
