import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function parseEnv(contents) {
  const values = {};
  const lines = contents.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (value.startsWith("{")) {
      let balance = (value.match(/\{/g) || []).length - (value.match(/\}/g) || []).length;
      while (balance > 0 && index + 1 < lines.length) {
        index += 1;
        const continuation = lines[index];
        value += `\n${continuation}`;
        balance += (continuation.match(/\{/g) || []).length - (continuation.match(/\}/g) || []).length;
      }
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export async function loadLocalEnv(path = ".env.local") {
  return parseEnv(await readFile(resolve(path), "utf8"));
}

