import { assertEquals } from "jsr:@std/assert@1";

Deno.test("app-api entrypoint is repo source, not a GitHub raw import stub", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));
  const trimmed = source.trim();
  assertEquals(/raw\.githubusercontent\.com/i.test(trimmed), false);
  assertEquals(trimmed.split("\n").length > 50, true);
  assertEquals(trimmed.startsWith("import "), true);
});

Deno.test("CodeAnt Major: worker candidate loading forwards preferred showcase evidence", () => {
  const source = Deno.readTextFileSync(new URL("../index.ts", import.meta.url)).replace(/\r\n/g, "\n");
  assertEquals(
    source.includes("function poseReferenceCandidates(references: ReferenceInput[], poseType: string, garmentFamily: string, preferredRole = \"\")"),
    true,
  );
  assertEquals(
    source.includes("selectReferences(references, [], poseType, garmentFamily, MAX_REFERENCES, preferredRole)"),
    true,
  );
  assertEquals(
    source.includes("poseReferenceCandidates(sourceInputs, poseData.id, garmentFamily, poseData.primaryReference)"),
    true,
  );
});

Deno.test("Railway idle sleep optimization: useQuery polls only active work and pg_cron pre-checks all worker operations", () => {
  const backendSource = Deno.readTextFileSync(
    new URL("../../../../src/lib/backend.ts", import.meta.url),
  ).replace(/\r\n/g, "\n");
  assertEquals(backendSource.includes("export function shouldPollEndpoint("), true);
  assertEquals(
    backendSource.includes("shouldPollEndpoint(endpoint, valueRef.current)"),
    true,
  );
  assertEquals(
    backendSource.includes("const pollableEndpoint = endpoint.startsWith(\"jobs.\") || endpoint.startsWith(\"catalog.\");"),
    true,
  );

  const cronMigration = Deno.readTextFileSync(
    new URL("../../../migrations/20261114190000_optimize_railway_idle_sleep_cron.sql", import.meta.url),
  ).replace(/\r\n/g, "\n");
  assertEquals(cronMigration.includes("ELSIF operation_name = 'catalogProduction.automation' THEN"), true);
  assertEquals(cronMigration.includes("ELSIF operation_name = 'usage.sync' THEN"), true);
  assertEquals(cronMigration.includes("ELSIF operation_name = 'events.automation' THEN"), true);
});
