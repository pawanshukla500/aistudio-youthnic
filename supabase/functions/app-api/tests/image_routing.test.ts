import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  allowedModelsForPurpose,
  defaultImageGenerationRoute,
  resolveStoredImageGenerationRoute,
} from "../lib/aiModelPolicy.ts";

const studioSource = Deno.readTextFileSync(
  new URL("../../../../src/features/studio/Studio.tsx", import.meta.url),
);
const outputSettingsSource = Deno.readTextFileSync(
  new URL("../../../../src/features/studio/components/OutputSettings.tsx", import.meta.url),
);
const apiSource = Deno.readTextFileSync(new URL("../index.ts", import.meta.url));

Deno.test("an administrator's stored GPT Image 2 route is the route that runs", () => {
  const resolved = resolveStoredImageGenerationRoute({
    primary_provider: "openai",
    primary_model: "gpt-image-2",
    primary_reasoning: "none",
    fallback_enabled: false,
    revision: 4,
  });
  assertEquals(resolved?.provider, "openai");
  assertEquals(resolved?.model, "gpt-image-2");
  assertEquals(resolved?.revision, 4);
  // The point of the regression: it must not come back as the flare default.
  assertEquals(resolved?.model === defaultImageGenerationRoute().model, false);
});

Deno.test("every approved image model survives a round trip through stored routing", () => {
  for (const model of allowedModelsForPurpose("openai", "image_generation")) {
    const resolved = resolveStoredImageGenerationRoute({
      primary_provider: "openai",
      primary_model: model,
      primary_reasoning: "none",
      fallback_enabled: false,
      revision: 1,
    });
    assertEquals(resolved?.model, model);
  }
});

Deno.test("only an absent row falls back to the system default", () => {
  assertEquals(resolveStoredImageGenerationRoute(null), null);
  assertEquals(resolveStoredImageGenerationRoute(undefined), null);
});

Deno.test("a stored route that is not approved is refused, never quietly replaced", () => {
  assertThrows(
    () =>
      resolveStoredImageGenerationRoute({
        primary_provider: "openai",
        primary_model: "gemini-3.8-flash",
        primary_reasoning: "none",
        fallback_enabled: false,
      }),
    Error,
    "Stored image-generation routing is invalid",
  );
  assertThrows(
    () =>
      resolveStoredImageGenerationRoute({
        primary_provider: "openai",
        primary_model: "gpt-image-2",
        primary_reasoning: "none",
        fallback_enabled: true,
      }),
    Error,
    "Clear its fallback",
  );
});

Deno.test("a Reve organization keeps its own route", () => {
  const resolved = resolveStoredImageGenerationRoute({
    primary_provider: "reve",
    primary_model: "reve-2.1-image",
    primary_reasoning: "none",
    fallback_enabled: false,
    revision: 2,
  });
  assertEquals(resolved?.provider, "reve");
  assertEquals(resolved?.model, "reve-2.1-image");
});

Deno.test("resolveImageGenerationPolicy no longer special-cases a single model id", () => {
  const body = apiSource.slice(apiSource.indexOf("async function resolveImageGenerationPolicy"));
  const fn = body.slice(0, body.indexOf("\n}\n") + 2);
  assertEquals(/primary_model\s*===/.test(fn), false);
  assertEquals(fn.includes("resolveStoredImageGenerationRoute(data)"), true);
});

Deno.test("a per-shoot override is validated against the organization's own provider", () => {
  // A hard-coded "openai" here rejected a Reve organization's override and then
  // silently ran the policy model instead, so the picker and this path must
  // share one allow-list.
  const validations = apiSource.match(
    /assertAllowedAiModelRoute\(\{\s*\n\s*provider: imageGenerationPolicy\.provider,\s*\n\s*model: requestedModel,/g,
  );
  assertEquals(
    validations?.length,
    2,
    "both the studio and catalog queue paths validate against the stored provider",
  );
  assertEquals(/assertAllowedAiModelRoute\(\{\s*\n\s*provider: "openai",/.test(apiSource), false);
});

Deno.test("ai.routing.effective serves the models the provider actually accepts", () => {
  assertEquals(
    apiSource.includes('allowedModels: allowedModelsForPurpose(imagePolicy.provider, "image_generation")'),
    true,
  );
});

Deno.test("Studio reports the organization route as configured, without rewriting it", () => {
  assertEquals(/rawOrgModel\s*===\s*"gpt-image-2"/.test(studioSource), false);
  assertEquals(/orgModel\s*=\s*.*\?\s*"gpt-image-2\.5-flare/.test(studioSource), false);
  assertEquals(studioSource.includes("userOverrodeModelRef"), false);
});

Deno.test("a new shoot carries no model override, so the organization route decides", () => {
  const defaults = studioSource.slice(studioSource.indexOf("const defaultOptions: OutputOptions = {"));
  const block = defaults.slice(0, defaults.indexOf("};"));
  assertEquals(/model:\s*""/.test(block), true);
  assertEquals(/model:\s*"gpt-image/.test(block), false);
});

Deno.test("the model picker offers the served list and an explicit no-override choice", () => {
  assertEquals(outputSettingsSource.includes("orgModelOptions?.length ? orgModelOptions : MODEL_OPTIONS"), true);
  assertEquals(outputSettingsSource.includes('<option value="">'), true);
  // Binding the control to the resolved model made an unset override look like
  // a deliberate one and re-sent it on submit.
  assertEquals(outputSettingsSource.includes("value={value.model}"), true);
});
