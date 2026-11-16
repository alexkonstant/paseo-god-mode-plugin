// Copies the version in package.json to every other place that carries it. `npm version X.Y.Z`
// runs this (the "version" script) before it commits and tags vX.Y.Z.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const write = (path, text) => writeFileSync(new URL(path, root), text);
const { version } = JSON.parse(read("package.json"));

for (const path of ["shared/version.ts", "server/core/version.mjs"]) {
  const text = read(path);
  const next = text.replace(/export const VERSION = "[^"]*";/, `export const VERSION = "${version}";`);
  if (!next.includes(`"${version}"`)) throw new Error(`${path}: no VERSION constant to update`);
  write(path, next);
}

console.log(`version ${version} synced`);
