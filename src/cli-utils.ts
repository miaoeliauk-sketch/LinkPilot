import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function parseOptionPairs(
  argumentsList: string[],
  usageMessage: string,
): Map<string, string> {
  const normalized = argumentsList.filter((argument) => argument !== "--");
  const values = new Map<string, string>();

  for (let index = 0; index < normalized.length; index += 2) {
    const key = normalized[index];
    const value = normalized[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(usageMessage);
    }
    values.set(key, value);
  }

  return values;
}

export function runCliIfMain(
  moduleUrl: string,
  runner: () => Promise<void>,
) {
  const entryPath = process.argv[1]
    ? pathToFileURL(resolve(process.argv[1])).href
    : "";
  if (entryPath !== moduleUrl) {
    return;
  }

  runner().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
