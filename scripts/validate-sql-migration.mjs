import { readFile } from "node:fs/promises";
import Module from "pg-query-emscripten";

const files = process.argv.slice(2);
if (!files.length)
  throw new Error("Pass at least one SQL migration to validate.");

for (const file of files) {
  const parser = await new Module();
  const sql = await readFile(file, "utf8");
  const result = parser.parse(sql);
  if (result.error) throw new Error(`${file}: ${result.error}`);
  console.log(`${file}: ${result.parse_tree.stmts.length} statements parsed`);
}
