import { assertEquals } from "jsr:@std/assert@1";
import { recordShowcaseFeatureOutcome } from "../catalogProduction.ts";

Deno.test("showcase feedback skips a bottom-led plan for an explicit top-only session", async () => {
  const tables: string[] = [];
  const sessionData = {
    category: "kurta set",
    bottomWearMode: "top_only",
    productIdentity: {
      garmentFamily: "kurta_or_kurti_set",
      bottomWearDetails: "Palazzo with wide flare",
    },
    creativeDirection: {
      showcasePlan: {
        heroFeature: "wide palazzo flare",
        featureRegion: "bottom_wear",
        shotType: "full_body_feature",
      },
    },
  };
  const service = {
    from(table: string) {
      tables.push(table);
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        update: () => query,
        limit: () => Promise.resolve({ data: [], error: null }),
        insert: () => Promise.resolve({ error: null }),
        maybeSingle: () => Promise.resolve({
          data: table === "catalog_sessions" ? { session_data: sessionData } : null,
          error: null,
        }),
      };
      return query;
    },
  };

  await recordShowcaseFeatureOutcome(service as never, {
    organizationId: "org-1",
    sessionId: "session-1",
    poseIndex: 6,
    poseType: "showcase",
    outcome: "selected",
  });

  assertEquals(tables, ["catalog_sessions"]);
});
