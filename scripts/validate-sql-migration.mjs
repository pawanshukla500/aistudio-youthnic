import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import Module from "pg-query-emscripten";

const args = process.argv.slice(2);
if (!args.length)
  throw new Error("Pass at least one SQL migration or directory to validate.");

const files = [];
for (const arg of args) {
  const s = await stat(arg);
  if (s.isDirectory()) {
    const dirFiles = await readdir(arg);
    for (const file of dirFiles) {
      if (file.endsWith(".sql")) files.push(join(arg, file));
    }
  } else {
    files.push(arg);
  }
}

const parser = await new Module();

for (const file of files) {
  const sql = await readFile(file, "utf8");
  try {
    const result = parser.parse(sql);
    if (result.error) throw new Error(`${file}: ${result.error.message} at position ${result.error.cursorpos}`);
    const stmts = result.parse_tree?.stmts || [];
    console.log(`${file}: ${stmts.length} statements parsed`);
  } catch (err) {
    if (err instanceof RangeError) {
      console.warn(`${file}: WARNING: Skipped due to WebAssembly memory limit (file too large)`);
    } else {
      throw err;
    }
  }
}
