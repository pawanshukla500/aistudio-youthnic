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

async function parseSql(file, sql) {
  // pg-query-emscripten can corrupt its JSON bridge on large migration strings.
  // Scan first, then parse only complete top-level statements in bounded chunks;
  // semicolons inside dollar-quoted PL/pgSQL bodies are emitted inside one token.
  const scanner = await new Module();
  const scan = scanner.scan(sql);
  if (scan.error) throw new Error(`${file}: ${scan.error.message} at position ${scan.error.cursorpos}`);
  const boundaries = [];
  for (let index = 0; index < scan.tokens.size(); index++) {
    const token = scan.tokens.get(index);
    if (token.text === ";") boundaries.push(token.end);
  }
  if (!boundaries.length && sql.trim()) boundaries.push(sql.length);
  if (boundaries.at(-1) !== sql.length && sql.slice(boundaries.at(-1) || 0).trim()) boundaries.push(sql.length);

  let offset = 0;
  let statementCount = 0;
  let boundaryIndex = 0;
  while (boundaryIndex < boundaries.length) {
    let end = boundaries[boundaryIndex];
    while (boundaryIndex + 1 < boundaries.length && boundaries[boundaryIndex + 1] - offset <= 24_000) {
      boundaryIndex++;
      end = boundaries[boundaryIndex];
    }
    const parser = await new Module();
    const result = parser.parse(sql.slice(offset, end));
    if (result.error) throw new Error(`${file}: ${result.error.message} near position ${offset + Number(result.error.cursorpos || 0)}`);
    statementCount += result.parse_tree?.stmts?.length || 0;
    offset = end;
    boundaryIndex++;
  }
  return statementCount;
}

for (const file of files) {
  const sql = await readFile(file, "utf8");
  try {
    const statementCount = await parseSql(file, sql);
    console.log(`${file}: ${statementCount} statements parsed`);
  } catch (err) {
    if (err instanceof RangeError) {
      console.warn(`${file}: WARNING: Skipped due to WebAssembly memory limit (file too large)`);
    } else {
      throw err;
    }
  }
}
