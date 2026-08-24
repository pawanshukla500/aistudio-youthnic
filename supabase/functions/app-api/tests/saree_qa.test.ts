import { assertEquals } from "jsr:@std/assert@1";
import { normalizePoseQaResult } from "../lib/qa.ts";

Deno.test("Saree QA Architecture: body_pallu_boundary failure should fail the pose", () => {
  const rawQaResponse = {
    pass: false,
    score: 80,
    checks: {
      body_pallu_boundary: "fail",
    },
    scores: {
      body_pallu_boundary: 60,
    },
    failed: ["body_pallu_boundary"],
    reason: "Pallu artwork bled into the body region.",
    correction: "Ensure pallu border and motif do not bleed into the plain body drape."
  };

  const qaResult = normalizePoseQaResult(rawQaResponse);
  
  assertEquals(qaResult.pass, false);
  assertEquals(qaResult.failed.includes("body_pallu_boundary"), true);
});

Deno.test("Saree QA Architecture: duplicate_pallu failure should fail the pose", () => {
  const rawQaResponse = {
    pass: false,
    score: 80,
    checks: {
      duplicate_pallu: "fail",
    },
    scores: {
      duplicate_pallu: 40,
    },
    failed: ["duplicate_pallu"],
    reason: "Generated two loose panels over the shoulder.",
    correction: "A saree only has one pallu. Remove the second loose panel."
  };

  const qaResult = normalizePoseQaResult(rawQaResponse);
  
  assertEquals(qaResult.pass, false);
  assertEquals(qaResult.failed.includes("duplicate_pallu"), true);
});

Deno.test("Saree QA Architecture: drape_physics failure should fail the pose", () => {
  const rawQaResponse = {
    pass: false,
    score: 85,
    checks: {
      drape_physics: "fail",
    },
    scores: {
      drape_physics: 70,
    },
    failed: ["drape_physics"],
    reason: "Fabric floats unnaturally like weightless chiffon instead of heavy silk.",
    correction: "Ensure the drape falls heavily as expected for stiff silk fabric."
  };

  const qaResult = normalizePoseQaResult(rawQaResponse);
  
  assertEquals(qaResult.pass, false);
  assertEquals(qaResult.failed.includes("drape_physics"), true);
});

Deno.test("Saree QA Architecture: blouse_invention failure should fail the pose", () => {
  const rawQaResponse = {
    pass: false,
    score: 80,
    checks: {
      blouse_invention: "fail",
    },
    scores: {
      blouse_invention: 40,
    },
    failed: ["blouse_invention"],
    reason: "Stitched back neck design with deep cut and dori invented.",
    correction: "The reference only showed an unstitched piece. Use a plain, simple stitched blouse instead of inventing complex styling."
  };

  const qaResult = normalizePoseQaResult(rawQaResponse);
  
  assertEquals(qaResult.pass, false);
  assertEquals(qaResult.failed.includes("blouse_invention"), true);
});
