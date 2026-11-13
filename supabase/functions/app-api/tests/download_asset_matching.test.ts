import { assertEquals } from "jsr:@std/assert@1";
import { matchImageAsset } from "../lib/downloadAssetMatching.ts";

const ALLOWED_ASSETS = [
  {
    storagePath: "organizations/7d56360f-2c96-4eb2-923e-f22b7fe36605/generated/job_abc-123/1-pose-hero.jpg",
    storageBackend: "firebase",
    fallbackUrl: "https://firebasestorage.googleapis.com/v0/b/bucket/o/organizations%2F7d56360f-2c96-4eb2-923e-f22b7fe36605%2Fgenerated%2Fjob_abc-123%2F1-pose-hero.jpg?alt=media&token=token-123",
  },
  {
    storagePath: "organizations/7d56360f-2c96-4eb2-923e-f22b7fe36605/generated/job_abc-123/11-pose-hero.jpg",
    storageBackend: "firebase",
    fallbackUrl: "https://firebasestorage.googleapis.com/v0/b/bucket/o/organizations%2F7d56360f-2c96-4eb2-923e-f22b7fe36605%2Fgenerated%2Fjob_abc-123%2F11-pose-hero.jpg?alt=media&token=token-456",
  },
  {
    storagePath: "organizations/7d56360f-2c96-4eb2-923e-f22b7fe36605/generated/job_abc-123/2-pose-side.jpg",
    storageBackend: "firebase",
    fallbackUrl: "https://firebasestorage.googleapis.com/v0/b/bucket/o/organizations%2F7d56360f-2c96-4eb2-923e-f22b7fe36605%2Fgenerated%2Fjob_abc-123%2F2-pose-side.jpg?alt=media&token=token-789",
  },
];

Deno.test("matchImageAsset matches exact storage path", () => {
  const result = matchImageAsset(ALLOWED_ASSETS, "organizations/7d56360f-2c96-4eb2-923e-f22b7fe36605/generated/job_abc-123/1-pose-hero.jpg");
  assertEquals(result?.storagePath, ALLOWED_ASSETS[0].storagePath);
});

Deno.test("matchImageAsset matches leading slash storage path", () => {
  const result = matchImageAsset(ALLOWED_ASSETS, "/organizations/7d56360f-2c96-4eb2-923e-f22b7fe36605/generated/job_abc-123/1-pose-hero.jpg");
  assertEquals(result?.storagePath, ALLOWED_ASSETS[0].storagePath);
});

Deno.test("matchImageAsset matches exact fallback URL with token query param", () => {
  const result = matchImageAsset(ALLOWED_ASSETS, "https://firebasestorage.googleapis.com/v0/b/bucket/o/organizations%2F7d56360f-2c96-4eb2-923e-f22b7fe36605%2Fgenerated%2Fjob_abc-123%2F1-pose-hero.jpg?alt=media&token=token-123");
  assertEquals(result?.storagePath, ALLOWED_ASSETS[0].storagePath);
});

Deno.test("matchImageAsset matches fallback URL with stripped query param", () => {
  const result = matchImageAsset(ALLOWED_ASSETS, "https://firebasestorage.googleapis.com/v0/b/bucket/o/organizations%2F7d56360f-2c96-4eb2-923e-f22b7fe36605%2Fgenerated%2Fjob_abc-123%2F1-pose-hero.jpg");
  assertEquals(result?.storagePath, ALLOWED_ASSETS[0].storagePath);
});

Deno.test("matchImageAsset matches URL-encoded storage path without query", () => {
  const result = matchImageAsset(ALLOWED_ASSETS, "https://firebasestorage.googleapis.com/v0/b/bucket/o/organizations%2F7d56360f-2c96-4eb2-923e-f22b7fe36605%2Fgenerated%2Fjob_abc-123%2F2-pose-side.jpg?alt=media");
  assertEquals(result?.storagePath, ALLOWED_ASSETS[2].storagePath);
});

Deno.test("matchImageAsset matches relative filename suffix with boundary", () => {
  const result = matchImageAsset(ALLOWED_ASSETS, "1-pose-hero.jpg");
  assertEquals(result?.storagePath, ALLOWED_ASSETS[0].storagePath);
});

Deno.test("matchImageAsset does NOT collide on partial substring suffix (1-pose-hero vs 11-pose-hero)", () => {
  // Querying for 1-pose-hero.jpg must return ALLOWED_ASSETS[0] and NOT ALLOWED_ASSETS[1]
  const result = matchImageAsset(ALLOWED_ASSETS, "1-pose-hero.jpg");
  assertEquals(result?.storagePath, ALLOWED_ASSETS[0].storagePath);

  // Querying for pose-hero.jpg (missing pose number) must return undefined to prevent ambiguity
  const ambiguous = matchImageAsset(ALLOWED_ASSETS, "pose-hero.jpg");
  assertEquals(ambiguous, undefined);
});

Deno.test("matchImageAsset rejects non-existent or foreign storage path", () => {
  const result = matchImageAsset(ALLOWED_ASSETS, "organizations/other-org/generated/fake.jpg");
  assertEquals(result, undefined);
});

Deno.test("matchImageAsset returns undefined on empty query", () => {
  const result = matchImageAsset(ALLOWED_ASSETS, "");
  assertEquals(result, undefined);
});
