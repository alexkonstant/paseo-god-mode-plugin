// Where God Mode keeps its own state. The host gives a plugin no data directory and its install path
// changes on every update, so everything lives under Paseo's home, readable only by this user.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** GOD_MODE_DATA_DIR moves it, for running the gateway on its own beside a live install. */
export const dataDir = () => process.env.GOD_MODE_DATA_DIR ?? join(process.env.PASEO_HOME ?? join(homedir(), ".paseo"), "god-mode");

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Atomic and private: a temporary file renamed into place, mode 0600 in a 0700 directory. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}
