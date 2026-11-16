// Run with: node --test core/*.test.mjs
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { daemonUrl, localCredential, localDaemon } from "./local.mjs";

function home(files) {
  const dir = mkdtempSync(join(tmpdir(), "god-mode-local-"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

test("the daemon's address comes from its lock file, then PASEO_LISTEN, then the default port", (t) => {
  const dirs = [];
  t.after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const at = (pid, listen) => {
    const dir = home(pid === undefined ? {} : { "paseo.pid": JSON.stringify(pid) });
    dirs.push(dir);
    return daemonUrl({ PASEO_HOME: dir, ...(listen ? { PASEO_LISTEN: listen } : {}) });
  };
  assert.equal(at({ listen: "127.0.0.1:6911" }), "ws://127.0.0.1:6911/ws");
  assert.equal(at({ listen: "0.0.0.0:7000" }), "ws://127.0.0.1:7000/ws", "a wildcard is reached on loopback");
  assert.equal(at({ listen: null }, "127.0.0.1:6912"), "ws://127.0.0.1:6912/ws", "an isolated daemon writes null; PASEO_LISTEN names it");
  assert.equal(at(undefined), "ws://127.0.0.1:6767/ws");
  assert.equal(at({ listen: "unix:///tmp/paseo.sock" }), null);
});

test("the local credential is read only when it has the daemon's shape", (t) => {
  const good = home({ "local-credential": `${"a".repeat(43)}\n` });
  const bad = home({ "local-credential": "not a credential" });
  const none = home({});
  t.after(() => [good, bad, none].forEach((d) => rmSync(d, { recursive: true, force: true })));
  assert.equal(localCredential({ PASEO_HOME: good }), "a".repeat(43));
  assert.equal(localCredential({ PASEO_HOME: bad }), null);
  assert.equal(localCredential({ PASEO_HOME: none }), null);
  const daemon = localDaemon({ secret: "s", env: { PASEO_HOME: good } });
  assert.deepEqual([daemon.url(), daemon.credential(), daemon.secret], ["ws://127.0.0.1:6767/ws", "a".repeat(43), "s"]);
});
