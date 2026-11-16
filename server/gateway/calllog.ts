// The call log behind get_logs: one JSON line per tool call in God Mode's data directory, newest last,
// cut back to the latest MAX_LINES once it grows past TRIM_AT. The core trims arguments and outputs
// before they get here, and nothing secret is in them.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface CallLogEntry {
  tool: string;
  args: string;
  ok: boolean;
  durationMs: number;
  output: string;
  error: string | null;
}

interface Row extends CallLogEntry {
  at: string;
  assistant: string;
}

const MAX_LINES = 2000;
const TRIM_AT = 2500;

export function createCallLog(file: string, now: () => Date = () => new Date()) {
  let lines: number | null = null;
  let queue = Promise.resolve();

  const rows = async (): Promise<Row[]> => {
    try {
      return (await readFile(file, "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Row);
    } catch {
      return [];
    }
  };

  const append = (row: Row) =>
    (queue = queue.then(async () => {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      lines ??= (await rows()).length;
      await appendFile(file, `${JSON.stringify(row)}\n`, { mode: 0o600 });
      lines += 1;
      if (lines > TRIM_AT) {
        const kept = (await rows()).slice(-MAX_LINES);
        await writeFile(file, kept.map((r) => `${JSON.stringify(r)}\n`).join(""), { mode: 0o600 });
        lines = kept.length;
      }
    }).catch(() => {}));

  return {
    /** The log as the core sees it for one assistant: record() after a call, recent() for get_logs. */
    as(assistant: string) {
      return {
        async record(entry: CallLogEntry) {
          await append({ at: now().toISOString(), assistant, ...entry });
        },
        async recent({ limit, errorsOnly, tool }: { limit: number; errorsOnly: boolean; tool?: string }) {
          await queue;
          const picked = (await rows())
            .filter((r) => (!errorsOnly || !r.ok) && (!tool || r.tool === tool))
            .slice(-limit)
            .reverse();
          if (picked.length === 0) return "No calls logged yet.";
          return picked
            .map((r) => `${r.at.slice(0, 19).replace("T", " ")} UTC ${r.assistant} ${r.tool} ${r.ok ? "ok" : "FAILED"} ${r.durationMs} ms ${r.args}\n  -> ${r.error ?? r.output}`)
            .join("\n");
        },
      };
    },
  };
}
