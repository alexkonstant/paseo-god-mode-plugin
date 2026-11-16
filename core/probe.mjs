// Runs the God Mode operations against the real Paseo daemon on this Mac, the way the plugin's
// gateway does. For trying changes before a reload.
//
//   node core/probe.mjs overview [--hours 12]
//   node core/probe.mjs chats [--project P] [--status running|waiting|new|all] [--query Q] [--archived]
//   node core/probe.mjs pinned [--project P] [--query Q]
//   node core/probe.mjs read <chat> [--view text|commands|thinking] [--turn 1] [--turns 3] [--max N]
//   node core/probe.mjs message <chat> [--role user|agent] [--turn 1] [--message N] [--id ID] [--mode head|tail|full] [--size N] [--offset N]
//   node core/probe.mjs activity [chat] [--max N] [--offset N]
//   node core/probe.mjs images [chat] [--turn N] [--image N] [--count N] [--save DIR]
//   node core/probe.mjs search <query…> [--project P] [--chat C] [--archived] [--scan 20] [--limit 10]
//   node core/probe.mjs models [provider]
//   node core/probe.mjs start <project|-> <prompt…> [--workspace W] [--provider P] [--model M] [--thinking T] [--mode M]
//   node core/probe.mjs set <chat> [--model M] [--thinking T]
//   node core/probe.mjs send <chat> <text…> [--if-busy steer|interrupt]
//   node core/probe.mjs approve <chat> allow|deny [--request N]
//   node core/probe.mjs request <chat>
//   node core/probe.mjs answer <chat> <request id> --answers JSON
//   node core/probe.mjs stop <chat>
//   node core/probe.mjs archive <chat>
//   node core/probe.mjs pin|unpin <chat> | --workspace W
//   node core/probe.mjs rename <chat> <new name…>
//   node core/probe.mjs rename-workspace <workspace> <new name…>
//   node core/probe.mjs plugins
//   node core/probe.mjs plugin-read <plugin> [operation] [--args JSON]
//   node core/probe.mjs plugin-act <plugin> <operation> [--args JSON] [--confirm TOKEN]
//   node core/probe.mjs commands <chat> [--query Q] [--limit 60]
//   node core/probe.mjs command <chat> <name> [args…] [--if-busy interrupt] [--confirm TOKEN]
//
// --json prints the structured data instead of the text; images print their size, never their
// bytes, and --save writes them to DIR to look at. It connects with the daemon's local credential
// (PASEO_HOME, default ~/.paseo), which is never printed.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  answerApproval,
  answerQuestions,
  archiveChat,
  listChats,
  listModels,
  listPinnedChats,
  listSlashCommands,
  overview,
  pinChat,
  pluginAction,
  pluginRead,
  readActivity,
  readApproval,
  readChat,
  readMessage,
  renameChat,
  renameWorkspace,
  runSlashCommand,
  searchMessages,
  setChatModel,
  showImages,
  sendMessage,
  startChat,
  stopChat,
} from "./paseo.mjs";
import { localDaemon } from "./local.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    hours: { type: "string" },
    project: { type: "string" },
    status: { type: "string" },
    query: { type: "string" },
    archived: { type: "boolean" },
    view: { type: "string" },
    turn: { type: "string" },
    turns: { type: "string" },
    max: { type: "string" },
    role: { type: "string" },
    message: { type: "string" },
    id: { type: "string" },
    size: { type: "string" },
    offset: { type: "string" },
    chat: { type: "string" },
    scan: { type: "string" },
    limit: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    thinking: { type: "string" },
    mode: { type: "string" },
    "if-busy": { type: "string" },
    image: { type: "string" },
    count: { type: "string" },
    save: { type: "string" },
    request: { type: "string" },
    args: { type: "string" },
    answers: { type: "string" },
    confirm: { type: "string" },
    workspace: { type: "string" },
    json: { type: "boolean" },
  },
});

const [command, first, ...rest] = positionals;
const number = (value, fallback) => (value === undefined ? fallback : Number(value));
// Confirmations the probe issues are signed with its own secret and work only in the probe.
const daemon = localDaemon({ secret: "god-mode-probe" });
const startedAt = Date.now();

const operations = {
  overview: () => overview(daemon, { hours: number(values.hours, 12) }),
  chats: () =>
    listChats(daemon, {
      project: values.project,
      status: values.status,
      query: values.query,
      includeArchived: Boolean(values.archived),
      limit: number(values.limit, 10),
    }),
  pinned: () => listPinnedChats(daemon, { project: values.project, query: values.query }),
  read: () =>
    readChat(daemon, {
      chat: first,
      view: values.view,
      turn: number(values.turn, 1),
      turns: number(values.turns, 1),
      maxChars: number(values.max, undefined),
    }),
  message: () =>
    readMessage(daemon, {
      chat: first,
      role: values.role,
      turn: number(values.turn, undefined),
      message: number(values.message, undefined),
      id: values.id,
      mode: values.mode,
      size: number(values.size, undefined),
      offset: number(values.offset, undefined),
    }),
  activity: () => readActivity(daemon, { chat: first, maxChars: number(values.max, undefined), offset: number(values.offset, undefined) }),
  images: () =>
    showImages(daemon, { chat: first, turn: number(values.turn, undefined), image: number(values.image, undefined), count: number(values.count, undefined) }),
  search: () =>
    searchMessages(daemon, {
      query: [first, ...rest].join(" "),
      project: values.project,
      chat: values.chat,
      includeArchived: Boolean(values.archived),
      scan: number(values.scan, undefined),
      limit: number(values.limit, 10),
    }),
  models: () => listModels(daemon, { provider: first }),
  start: () =>
    startChat(daemon, {
      project: first === "-" ? undefined : first,
      workspace: values.workspace,
      prompt: rest.join(" "),
      provider: values.provider,
      model: values.model,
      thinking: values.thinking,
      mode: values.mode,
    }),
  set: () => setChatModel(daemon, { chat: first, model: values.model, thinking: values.thinking }),
  send: () =>
    sendMessage(daemon, { chat: first, text: rest.join(" "), ifBusy: values["if-busy"] }),
  approve: () => answerApproval(daemon, { chat: first, decision: rest[0], request: values.request }),
  request: () => readApproval(daemon, { chat: first }),
  answer: () => answerQuestions(daemon, { chat: first, request: rest[0], answers: JSON.parse(values.answers ?? "[]") }),
  stop: () => stopChat(daemon, { chat: first }),
  archive: () => archiveChat(daemon, { chat: first }),
  pin: () => pinChat(daemon, { chat: first, workspaceId: values.workspace, action: "pin" }),
  unpin: () => pinChat(daemon, { chat: first, workspaceId: values.workspace, action: "unpin" }),
  rename: () => renameChat(daemon, { chat: first, name: rest.join(" ").trim() }),
  "rename-workspace": () => renameWorkspace(daemon, { workspace: first, name: rest.join(" ").trim() }),
  plugins: () => pluginRead(daemon, {}),
  "plugin-read": () => pluginRead(daemon, { plugin: first, operation: rest[0], args: values.args ? JSON.parse(values.args) : undefined }),
  "plugin-act": () =>
    pluginAction(daemon, { plugin: first, operation: rest[0], args: values.args ? JSON.parse(values.args) : undefined, confirmation: values.confirm }),
  commands: () => listSlashCommands(daemon, { chat: first, query: values.query, limit: number(values.limit, 60) }),
  command: () =>
    runSlashCommand(daemon, {
      chat: first,
      command: rest[0],
      args: rest.slice(1).join(" "),
      ifBusy: values["if-busy"],
      confirmation: values.confirm,
    }),
};

if (!operations[command]) {
  console.error(`Unknown command "${command}". See the header of core/probe.mjs.`);
  process.exit(2);
}
const result = await operations[command]();
console.log(values.json ? JSON.stringify(result.data ?? result, null, 2) : (result.text ?? result.invalid ?? result.error));
for (const image of result.meta?.["god-mode/images"]?.images ?? []) {
  const bytes = Buffer.from(image.data, "base64");
  console.log(`image: turn ${image.turn} #${image.n} ${image.mime} ${bytes.length} bytes`);
  if (values.save) {
    mkdirSync(values.save, { recursive: true });
    writeFileSync(join(values.save, `turn${image.turn}-image${image.n}.${image.mime.split("/")[1]}`), bytes);
  }
}
console.log(`(${Date.now() - startedAt} ms)`);
