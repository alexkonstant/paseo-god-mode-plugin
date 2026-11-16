import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { VERSION } from "./version.ts";

const root = join(import.meta.dirname, "..");
const read = (...path: string[]) => readFileSync(join(root, ...path), "utf8");

test("every place that carries the version carries the one in package.json", () => {
  const { version } = JSON.parse(read("package.json"));
  assert.equal(VERSION, version, "shared/version.ts");
  assert.equal(/VERSION = "([^"]+)"/.exec(read("core", "version.mjs"))?.[1], version, "core/version.mjs");
});
