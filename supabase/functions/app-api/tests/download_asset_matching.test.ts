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
  const result = matchImageAsset(ALLOWED_ASSETS, "1-pose-hero.jpg");
  assertEquals(result?.storagePath, ALLOWED_ASSETS[0].storagePath);

  const ambiguous = matchImageAsset(ALLOWED_ASSETS, "pose-hero.jpg");
  assertEquals(ambiguous, undefined);
});

Deno.test("matchImageAsset rejects root slash and query-only paths", () => {
  assertEquals(matchImageAsset(ALLOWED_ASSETS, "/"), undefined);
  assertEquals(matchImageAsset(ALLOWED_ASSETS, "///"), undefined);
  assertEquals(matchImageAsset(ALLOWED_ASSETS, "?alt=media"), undefined);
  assertEquals(matchImageAsset(ALLOWED_ASSETS, "/?alt=media"), undefined);
});

Deno.test("matchImageAsset rejects extension-only queries", () => {
  assertEquals(matchImageAsset(ALLOWED_ASSETS, ".jpg"), undefined);
  assertEquals(matchImageAsset(ALLOWED_ASSETS, "jpg"), undefined);
});

Deno.test("matchImageAsset rejects partial filename substrings without slash boundary", () => {
  assertEquals(matchImageAsset(ALLOWED_ASSETS, "hero.jpg"), undefined);
  assertEquals(matchImageAsset(ALLOWED_ASSETS, "-hero.jpg"), undefined);
  assertEquals(matchImageAsset(ALLOWED_ASSETS, "side.jpg"), undefined);
});

Deno.test("matchImageAsset handles trailing slashes and backslashes", () => {
  const resultTrailing = matchImageAsset(ALLOWED_ASSETS, "1-pose-hero.jpg/");
  assertEquals(resultTrailing?.storagePath, ALLOWED_ASSETS[0].storagePath);

  const resultBackslash = matchImageAsset(ALLOWED_ASSETS, "organizations\\7d56360f-2c96-4eb2-923e-f22b7fe36605\\generated\\job_abc-123\\1-pose-hero.jpg");
  assertEquals(resultBackslash?.storagePath, ALLOWED_ASSETS[0].storagePath);
});

Deno.test("matchImageAsset rejects strings with null bytes", () => {
  assertEquals(matchImageAsset(ALLOWED_ASSETS, "1-pose-hero.jpg\0"), undefined);
});

Deno.test("matchImageAsset rejects non-existent or foreign storage path", () => {
  const result = matchImageAsset(ALLOWED_ASSETS, "organizations/other-org/generated/fake.jpg");
  assertEquals(result, undefined);
});

Deno.test("matchImageAsset matches candidate when storagePath is empty and only fallbackUrl is populated", () => {
  const assetsWithoutStoragePath = [
    {
      storagePath: "",
      storageBackend: "firebase",
      fallbackUrl: "https://firebasestorage.googleapis.com/v0/b/bucket/o/organizations%2F7d56360f-2c96-4eb2-923e-f22b7fe36605%2Fgenerated%2Fjob_abc-123%2F3-pose-back.jpg?alt=media&token=token-999",
    },
  ];
  const byFilename = matchImageAsset(assetsWithoutStoragePath, "3-pose-back.jpg");
  assertEquals(byFilename?.fallbackUrl, assetsWithoutStoragePath[0].fallbackUrl);

  const byFullUrl = matchImageAsset(assetsWithoutStoragePath, assetsWithoutStoragePath[0].fallbackUrl);
  assertEquals(byFullUrl?.fallbackUrl, assetsWithoutStoragePath[0].fallbackUrl);
});

Deno.test("matchImageAsset returns undefined on empty query", () => {
  assertEquals(matchImageAsset(ALLOWED_ASSETS, ""), undefined);
  assertEquals(matchImageAsset(ALLOWED_ASSETS, "   "), undefined);
});
