# God Mode documentation

| Document | For | What is in it |
| --- | --- | --- |
| [architecture.md](architecture.md) | Everyone | The gateway, the tunnel, the core; one sign-in, one tool call, one plugin action. |
| [configuration.md](configuration.md) | Users | Setting up the address, connecting Claude and ChatGPT, disconnecting; what God Mode keeps on the Mac. |
| [tools.md](tools.md) | Users, developers | The tools Claude and ChatGPT get, their arguments and conventions. |
| [slash-commands.md](slash-commands.md) | Users, developers | `list_slash_commands` and `run_slash_command`: what runs for Claude Code and Codex, and what does not, with the reasons. |
| [voice-button.md](voice-button.md) | Users | The optional button in Paseo that opens ChatGPT's voice chat. |
| [plugin-tools.md](plugin-tools.md) | Plugin authors, developers | `plugin_read` and `plugin_action`: discovery, names, arguments, results, outcomes, confirmations. |
| [plugin-capabilities.md](plugin-capabilities.md) | Plugin authors | The `meta.describe` contract, `paseo.capabilities/1`: every field, `outcome`, `target`, `untrusted`. |
| [plugin-authoring.md](plugin-authoring.md) | Plugin authors | Implementing and testing `meta.describe` in a Paseo plugin; what not to describe. |
| [security.md](security.md) | Everyone | The trust model, sign-in, writes and confirmations, what is and is not guaranteed, errors. |
| [operations.md](operations.md) | Users | Updates, logs, when an assistant shows old tools, troubleshooting. |
| [development.md](development.md) | Developers | Layout, checks, running against Paseo, a separate Paseo for testing, the eval, releases. |

Changes by version: [CHANGELOG.md](../CHANGELOG.md).
