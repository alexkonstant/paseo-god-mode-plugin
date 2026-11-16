// Run with: node --test core/
// read_activity over a fake daemon client: which subagents it lists, how many it reads in detail, and
// the model and effort it gives for each. No network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readActivityOn } from "./paseo.mjs";

// readActivityOn reads the clock itself, so the fixture is laid out from now.
const NOW = Date.now();
const at = (minutes) => new Date(NOW - minutes * 60_000).toISOString();
const ID = "6194696e-afb1-4724-9bec-bec061a5a54f";

const sub = (n, subtitle, extra = {}) => ({
  id: `toolu_${n}`,
  parentAgentId: ID,
  parentSubagentId: null,
  provider: "claude",
  title: "general-purpose",
  description: `task ${n}`,
  status: "running",
  createdAt: at(15),
  updatedAt: at(1),
  toolCallId: `toolu_${n}`,
  cwd: null,
  subtitle,
  ...extra,
});

// The subagents of one working chat, laid out as Paseo 0.14.0 listed them on a live chat: seven running
// on three models, one resumed by SendMessage (an effort and no model), one finished this turn.
const SUBAGENTS = [
  sub(1, "general-purpose · Opus 5.5 · Max · 305.1k tokens"),
  sub(2, "general-purpose · Opus 5.5 · Max · 346.3k tokens"),
  sub(3, "general-purpose · Opus 5.5 · Max · 220.5k tokens"),
  sub(4, "general-purpose · Sonnet 5.5 · Max · 180.4k tokens"),
  sub(5, "general-purpose · Haiku 5.5 · Max · 83.2k tokens"),
  sub(6, "general-purpose · Haiku 5.5 · Max · 66.3k tokens"),
  sub(7, "general-purpose · Haiku 5.5 · Max"),
  sub(8, "general-purpose · Max · 262.3k tokens"),
  sub(9, "Explore · Opus 5.5 · Max · 284.1k tokens", { title: "Explore", status: "completed", updatedAt: at(3) }),
];

function fakeClient({ subagents = SUBAGENTS, status = "running", finalMessage = (id) => `result of ${id}`, unreadable = [] } = {}) {
  const read = [];
  const entry = {
    agent: { id: ID, title: "Gaslight Me", status, requiresAttention: false, pendingPermissions: [], updatedAt: at(1), createdAt: at(600), cwd: "/Users/r/lacoNote", provider: "claude", model: "claude-opus-5-5", thinkingOptionId: "max" },
    project: { projectName: "lacoNote", workspaceName: null },
  };
  return {
    read,
    async fetchAgents() {
      return { entries: [entry] };
    },
    async fetchAgent(id) {
      return id === ID ? entry : null;
    },
    async listAgentTimelinePrompts() {
      return { prompts: [{ seq: 1, preview: "go", timestamp: at(30) }] };
    },
    async fetchAgentTimeline() {
      return { entries: [] };
    },
    async listProviderSubagents() {
      return { subagents };
    },
    async fetchProviderSubagentTimeline(_chat, id) {
      read.push(id);
      if (unreadable.includes(id)) throw new Error("timeline unavailable");
      return { rows: [{ item: { type: "assistant_message", text: finalMessage(id) } }] };
    },
  };
}

// Five subagents that finished a day before the chat's latest prompt, as on the live chat this was
// found on: read_activity gave subagents_done 5 and an empty list.
const DAY = 24 * 60;
const FINISHED_EARLIER = [
  ["Threads API and Meta rules research", "46k"],
  ["Postiz multi-employee code audit", "101k"],
  ["Paseo multi-user architecture and UX", "79.8k"],
  ["Postiz posting internals audit", "118.9k"],
  ["Paseo boundary for a Go backend", "100.1k"],
].map(([description, tokens], i) =>
  sub(i + 1, `general-purpose · Sonnet 5.5 · Medium · ${tokens} tokens`, { description, status: "completed", createdAt: at(DAY + 60 - 10 * i), updatedAt: at(DAY + 58 - 10 * i) }),
);

test("a named chat lists subagents finished before its latest turn, each with its model, effort, task, status and result", async () => {
  const client = fakeClient({ subagents: FINISHED_EARLIER, status: "idle" });
  const { text, data } = await readActivityOn(client, { chat: "Gaslight Me" });
  const [activity] = data.chats;
  assert.equal(activity.subagents_done, 5);
  assert.deepEqual(
    activity.subagents.map((s) => [s.id, s.task, s.status, s.model, s.effort, s.tokens, s.result, s.result_id]),
    [...FINISHED_EARLIER].reverse().map((s) => [s.id, s.description, "completed", "Sonnet 5.5", "Medium", s.subtitle.match(/([\d.]+k) tokens/)[1], `result of ${s.id}`, `subagent-${s.id}`]),
    "the most recently finished first",
  );
  assert.deepEqual([activity.offset, activity.next_offset], [0, null]);
  assert.equal(activity.chat.model, "claude-opus-5-5", "the chat runs on another model than its subagents did");
  assert.match(text, /- general-purpose \(Sonnet 5\.5, Medium effort\) "Paseo boundary for a Go backend": completed after 2 min\. Result: result of toolu_5/);
  assert.equal(text.split("\n").filter((l) => l.startsWith("- ")).length, 5, "the text has every one of them too");
  assert.doesNotMatch(text, /not listed|The next ones/, "the list is whole, so nothing says otherwise");
});

test("a named chat at work: running subagents come first with their step, then the finished ones of every turn", async () => {
  const running = sub(6, "general-purpose · Opus 5.5 · High · 12k tokens", { description: "still going" });
  const client = fakeClient({ subagents: [...FINISHED_EARLIER, running] });
  const { data } = await readActivityOn(client, { chat: "Gaslight Me" });
  const [activity] = data.chats;
  assert.equal(activity.working, true);
  assert.deepEqual(activity.subagents.map((s) => s.id), ["toolu_6", ...[...FINISHED_EARLIER].reverse().map((s) => s.id)]);
  assert.deepEqual([activity.subagents[0].status, activity.subagents[0].model, activity.subagents[0].effort, activity.subagents[0].result], ["running", "Opus 5.5", "High", null]);
  assert.match(activity.subagents[0].current_step, /^writing: result of toolu_6/);
  assert.equal(activity.subagents_running, 1);
  assert.equal(activity.subagents_done, 5);
});

test("without a chat a subagent finished before the latest turn still only counts, and the text says how to list it", async () => {
  const running = sub(6, "general-purpose · Opus 5.5 · High · 12k tokens", { description: "still going" });
  const client = fakeClient({ subagents: [...FINISHED_EARLIER, running] });
  const { text, data } = await readActivityOn(client, {});
  const [activity] = data.chats;
  assert.deepEqual(activity.subagents.map((s) => s.id), ["toolu_6"]);
  assert.deepEqual(client.read, ["toolu_6"], "only what is listed is read");
  assert.equal(activity.subagents_done, 5);
  assert.equal("next_offset" in activity, false, "no paging without a chat");
  assert.match(text, /5 more subagent\(s\) of this chat are not listed: name the chat to list them all, finished ones included\./);
});

test("more subagents than one answer holds are read page by page: each exactly once, each with its result", async () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    sub(i + 1, "general-purpose · Haiku 5.5 · Low · 1k tokens", { status: "completed", createdAt: at(DAY - i), updatedAt: at(DAY - i - 1) }),
  );
  const client = fakeClient({ subagents: many, status: "idle" });
  const seen = [];
  const texts = [];
  for (let offset = 0; offset !== null; ) {
    const before = client.read.length;
    const { text, data } = await readActivityOn(client, { chat: "Gaslight Me", offset });
    const [activity] = data.chats;
    assert.ok(activity.subagents.length <= 15, "a page stays small enough to reach the model whole");
    assert.equal(activity.offset, offset);
    assert.equal(client.read.length - before, activity.subagents.length, "each one listed is read, and only those");
    assert.ok(activity.subagents.every((s) => s.model === "Haiku 5.5" && s.result === `result of ${s.id}`));
    assert.equal(activity.subagents_done, 40, "the counts are the whole chat's on every page");
    seen.push(...activity.subagents.map((s) => s.id));
    texts.push(text);
    offset = activity.next_offset;
  }
  assert.deepEqual(seen, many.map((s) => s.id).reverse(), "the most recently finished first, none twice, none lost");
  assert.equal(texts.length, 3);
  assert.match(texts[0], /Subagents 1-15 of 40\. The next ones: read_activity with offset 15\./);
  assert.match(texts[2], /Subagents 31-40 of 40\.\n/);
  assert.doesNotMatch(texts[2], /The next ones/);
});

test("an offset past the end lists nothing, says how many there are, and reads nothing", async () => {
  const client = fakeClient({ subagents: FINISHED_EARLIER, status: "idle" });
  const { text, data } = await readActivityOn(client, { chat: "Gaslight Me", offset: 20 });
  assert.deepEqual([data.chats[0].subagents, data.chats[0].next_offset], [[], null]);
  assert.deepEqual(client.read, []);
  assert.match(text, /No subagents from number 21: the chat has 5\./);
});

test("the text of a full page keeps every subagent's line by default, and max_chars still cuts it", async () => {
  const many = Array.from({ length: 15 }, (_, i) =>
    sub(i + 1, "general-purpose · Haiku 5.5 · Low · 1k tokens", { description: "t".repeat(200), status: "completed", createdAt: at(DAY), updatedAt: at(DAY - i) }),
  );
  const finalMessage = () => "word ".repeat(2000);
  const lines = async (args) => (await readActivityOn(fakeClient({ subagents: many, status: "idle", finalMessage }), { chat: "Gaslight Me", ...args })).text.split("\n").filter((l) => l.startsWith("- ")).length;
  assert.equal(await lines({}), 15, "no line is lost to the default budget, however long the results are");
  assert.ok((await lines({ maxChars: 1500 })) < 15, "an explicit budget is honoured");
});

test("what Paseo did not report stays unknown for a finished subagent: never the chat's own model", async () => {
  const finished = { status: "completed", createdAt: at(DAY), updatedAt: at(DAY - 1) };
  const subagents = [
    sub(1, null, { ...finished }),
    sub(2, "general-purpose · Max", { ...finished, status: "canceled", updatedAt: at(DAY - 2) }),
    sub(3, "general-purpose · gpt-5 · High", { ...finished, provider: "codex", status: "failed", updatedAt: at(DAY - 3) }),
  ];
  const { text, data } = await readActivityOn(fakeClient({ subagents, status: "idle" }), { chat: "Gaslight Me" });
  assert.deepEqual(
    data.chats[0].subagents.map((s) => [s.id, s.status, s.model, s.effort]),
    [
      ["toolu_3", "failed", null, null],
      ["toolu_2", "canceled", null, "Max"],
      ["toolu_1", "completed", null, null],
    ],
  );
  assert.match(text, /model not reported, Max effort/);
  assert.match(text, /model and effort not reported/);
  assert.doesNotMatch(text, /claude-opus-5-5/);
});

test("a finished subagent whose timeline cannot be read keeps its model and effort, and its result can still be asked for", async () => {
  const client = fakeClient({ subagents: FINISHED_EARLIER, status: "idle", unreadable: ["toolu_3"] });
  const { data } = await readActivityOn(client, { chat: "Gaslight Me" });
  const entry = data.chats[0].subagents.find((s) => s.id === "toolu_3");
  assert.deepEqual([entry.model, entry.effort, entry.status, entry.result, entry.result_id], ["Sonnet 5.5", "Medium", "completed", null, "subagent-toolu_3"]);
  assert.equal(data.chats[0].subagents.filter((s) => s.result !== null).length, 4, "the others are unaffected");
});

test("one named chat gives every subagent with its model and effort, each read in detail", async () => {
  const client = fakeClient();
  const { text, data } = await readActivityOn(client, { chat: "Gaslight Me", maxChars: 6000 });
  const [activity] = data.chats;
  assert.equal(activity.subagents.length, 9, "none is cut off");
  assert.deepEqual(
    activity.subagents.map((s) => [s.model, s.effort]),
    [
      ["Opus 5.5", "Max"],
      ["Opus 5.5", "Max"],
      ["Opus 5.5", "Max"],
      ["Sonnet 5.5", "Max"],
      ["Haiku 5.5", "Max"],
      ["Haiku 5.5", "Max"],
      ["Haiku 5.5", "Max"],
      [null, "Max"],
      ["Opus 5.5", "Max"],
    ],
  );
  assert.equal(activity.subagents[7].model, null, "the resumed subagent has no model of its own: unknown, not its parent's");
  assert.equal(activity.subagents_running, 8);
  assert.equal(activity.subagents_done, 1);
  assert.deepEqual([...client.read].sort(), SUBAGENTS.map((s) => s.id).sort(), "every one listed is read");
  assert.equal(activity.subagents[8].result, "result of toolu_9", "the ninth has its result as well");
  assert.match(text, /- general-purpose \(Sonnet 5\.5, Max effort\) "task 4": running for 15 min/);
  assert.match(text, /- general-purpose \(model not reported, Max effort\) "task 8": running for 15 min/);
  assert.match(text, /- Explore \(Opus 5\.5, Max effort\) "task 9": completed after 12 min/);
});

test("without a chat the first six of each chat are listed, and their counts say how many there are", async () => {
  const client = fakeClient();
  const { data } = await readActivityOn(client, {});
  const [activity] = data.chats;
  assert.equal(activity.subagents.length, 6);
  assert.equal(activity.subagents_running, 8);
  assert.deepEqual(activity.subagents.map((s) => s.model), ["Opus 5.5", "Opus 5.5", "Opus 5.5", "Sonnet 5.5", "Haiku 5.5", "Haiku 5.5"]);
  assert.equal(client.read.length, 6);
});

test("the six read in detail are the six listed first: running ones, then the most recently finished", async () => {
  // Eight finished this turn, listed by Paseo oldest first: the last one finished most recently.
  const finished = Array.from({ length: 8 }, (_, i) => sub(i + 1, "general-purpose · Haiku 5.5 · Max · 10k tokens", { status: "completed", createdAt: at(20), updatedAt: at(10 - i) }));
  const client = fakeClient({ subagents: finished, status: "running" });
  const { data } = await readActivityOn(client, {});
  const listed = data.chats[0].subagents;
  assert.deepEqual(listed.map((s) => s.id), finished.map((s) => s.id).reverse().slice(0, 6), "most recently finished first");
  assert.ok(listed.every((s) => s.result !== null), "results are there for the six");
  assert.deepEqual([...client.read].sort(), listed.map((s) => s.id).sort(), "and only those were read");
});

test("a chat with no subagents, or whose daemon lists none, gives an empty list", async () => {
  const { data } = await readActivityOn(fakeClient({ subagents: [], status: "idle" }), { chat: "Gaslight Me" });
  assert.deepEqual(data.chats[0].subagents, []);
  assert.equal(data.chats[0].subagents_running, 0);
});
