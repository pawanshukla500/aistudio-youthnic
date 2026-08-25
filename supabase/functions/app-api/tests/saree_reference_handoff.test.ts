import { assertEquals } from "jsr:@std/assert@1";
import {
  promoteLegacySareeReference,
  remapDetectedSareeReferences,
} from "../../../../src/features/studio/sareeReferenceHandoff.ts";

const file = new File(["evidence"], "saree.jpg", { type: "image/jpeg" });
const reference = (id: string, role: string) => ({ id, role: role as any, file, previewUrl: `blob:${id}`, uploadedId: id as any });

Deno.test("detected saree safely carries explicit front/back labels into regional roles", () => {
  const remapped = remapDetectedSareeReferences({
    front: reference("front", "front"),
    back: reference("back", "back"),
    fabric_pattern: reference("fabric", "fabric_pattern"),
  } as any);

  assertEquals(remapped.front, undefined);
  assertEquals(remapped.back, undefined);
  assertEquals(remapped.saree_front_drape?.role, "saree_front_drape");
  assertEquals(remapped.saree_back_drape?.role, "saree_back_drape");
  assertEquals(remapped.saree_front_drape?.uploadedId, undefined);
  assertEquals(remapped.fabric_pattern?.role, "fabric_pattern");
  assertEquals(remapped.saree_pallu_spread, undefined);
});

Deno.test("pallu evidence is promoted only by an explicit member action", () => {
  const source = {
    front: reference("front", "front"),
    fabric_pattern: reference("fabric", "fabric_pattern"),
  } as any;
  const promoted = promoteLegacySareeReference(source, "fabric_pattern", "saree_pallu_spread", "pallu");

  assertEquals(source.saree_pallu_spread, undefined);
  assertEquals(promoted.fabric_pattern, undefined);
  assertEquals(promoted.saree_pallu_spread?.role, "saree_pallu_spread");
  assertEquals(promoted.saree_pallu_spread?.id, "pallu");
  assertEquals(promoted.saree_pallu_spread?.uploadedId, undefined);
});
