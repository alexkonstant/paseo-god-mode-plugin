# Development

How to work on God Mode: layout, checks, running against Paseo, a separate Paseo for testing, the eval,
compatibility rules and releases. The parts and how they fit: [architecture.md](architecture.md).

## Setup

```sh
npm ci
paseo plugin add "$PWD"   # run the plugin from this checkout (the CLI is inside Paseo.app)
```

Node.js 22.13 or newer. After a change, `paseo plugin reload god-mode`. Paseo builds the plugin's
modules with esbuild on every load, and only from `client/`, `server/` and `shared/`: code outside them
fails the build.

## Checks

```sh
npm run check
```

It runs the typecheck (`tsc --noEmit`) and every test:
`node --test "server/**/*.test.ts" "shared/**/*.test.ts" "server/core/*.test.mjs"`.

No test needs network or Paseo. The core's operations are tested against fake daemon clients
(`server/core/*.test.mjs`; `slash-flow.test.mjs` plays Paseo's Claude and Codex providers as they
behaved on live chats), the tool layer against fake operations (`mcp.test.mjs`), OAuth on its own
(`server/gateway/oauth.test.ts`) and the gateway over real HTTP on a free port (`http.test.ts`). CI runs
`npm run check` on every push to `main` and on pull requests.

## Running the core against your Paseo

`server/core/probe.mjs` runs the same operations the gateway runs, against the daemon on this Mac, with
its local credential (it never prints it):

```sh
node server/core/probe.mjs overview [--hours 12]
node server/core/probe.mjs chats [--project P] [--status running|waiting|new|all] [--query Q] [--archived]
node server/core/probe.mjs read <chat> [--view text|commands|thinking] [--turn 1] [--turns 3] [--max N]
node server/core/probe.mjs activity [chat] [--max N] [--offset N]
node server/core/probe.mjs send <chat> <text…> [--if-busy steer|interrupt]
node server/core/probe.mjs plugins
node server/core/probe.mjs commands <chat> [--query Q] [--limit 60]
```

The full list is at the top of the file. The write commands (`start`, `set`, `send`, `approve`,
`answer`, `stop`, `archive`, `pin`, `unpin`, `rename`, `rename-workspace`, `plugin-act`, `command`) act
on your real agents, sidebar and plugins. `--json` prints the structured data instead of the text.
`PASEO_HOME` and `PASEO_LISTEN` point it at another daemon.

## The gateway on its own

`server/gateway/service.ts` runs outside Paseo too, for a quick check beside a live install:

```js
process.env.GOD_MODE_DATA_DIR = "/tmp/god-mode-data"; // not your real ~/.paseo/god-mode
const { Gateway } = await import("./server/gateway/service.ts");
const gateway = new Gateway(47861);
await gateway.start();
console.log(gateway.connect()); // a sign-in code for a client you drive yourself
```

`GOD_MODE_PORT`, `GOD_MODE_DATA_DIR` and `GOD_MODE_PUBLIC_URL` override the port, the data folder and
the public address. Inside Paseo they do not apply: a plugin gets the login shell's environment.

## A separate Paseo for testing

Try a change on a daemon of its own before reloading your real one:

```text
env -i HOME=<dir>/home PASEO_HOME=<dir>/paseo PASEO_LISTEN=127.0.0.1:<port> PASEO_RELAY_ENABLED=false \
  PASEO_WEB_UI_ENABLED=true <paseo CLI> daemon run --home <dir>/paseo
paseo plugin add "$PWD" --home <dir>/paseo
```

Put `"pluginsEnabled": true` and `"daemon": { "listen": "127.0.0.1:<port>" }` in
`<dir>/paseo/config.json` before the first start. Its web client is at `http://127.0.0.1:<port>/`. The
gateway inside it wants port 47860 like your real one, so the two do not run at the same time; anything
that talks to a daemon names it explicitly and never falls back to 6767.

## The tool-selection eval

`eval/` measures what a real OpenAI model does with the instructions and tool descriptions, through the
Codex CLI against a stub server over a fake Paseo: see [eval/README.md](../eval/README.md). Runs use
your Codex usage allowance. Claude reads the same descriptions but sees only a result's text and gets
the instructions late, so the rules that matter belong in the tool descriptions.

## Compatibility rules

- **One version** (`MAJOR.MINOR.PATCH`) covers the plugin, its gateway and the core.
- **Within a major version, tools are only added**, never removed or renamed. Output fields are added,
  not removed; a tool's `outputSchema` must not use a nullable object type (a test checks it).
- **The plugin contract is additive**: new keys in [paseo.capabilities/1](plugin-capabilities.md) are
  optional, and God Mode ignores keys it does not know.
- **`@getpaseo/*` is pinned.** The core uses an internal entry point of `@getpaseo/client`; re-run the
  probe before bumping it.
- A change to anything the model reads (instructions, tool descriptions) changes `serverInfo.version`
  (the version plus a fingerprint of that text).

## Releasing

1. Add the version's section to [CHANGELOG.md](../CHANGELOG.md).
2. `npm version X.Y.Z && git push --follow-tags`. `preversion` runs the checks; the version script
   writes the version into `shared/version.ts` and `server/core/version.mjs`, and npm commits
   "Release vX.Y.Z" and tags it.
3. The tag's workflow checks that the tag is the version in `package.json`, runs the checks again and
   publishes the GitHub release with the CHANGELOG section as its notes.
4. Update the plugin in Paseo to that version.
