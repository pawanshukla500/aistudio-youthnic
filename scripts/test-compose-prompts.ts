import fs from "fs";
import { normalizeAnalysis } from "../supabase/functions/app-api/lib/profiles.ts";
import { composeGenerationPrompt } from "../supabase/functions/app-api/lib/generationPrompt.ts";
import { getPoseSlots } from "../supabase/functions/app-api/lib/profiles.ts";

// Load analysis JSON
const raw = JSON.parse(fs.readFileSync("scripts/new_mogra_analysis.json", "utf8"));
const normalized = normalizeAnalysis(raw, "ethnic/fusion");

console.log("=== NORMALIZED PRODUCT IDENTITY ===");
console.log("Garment Family:", normalized.productIdentity.garmentFamily);
console.log("Bottom Wear Details:\n", normalized.productIdentity.bottomWearDetails);

const poses = getPoseSlots({
  productIdentity: normalized.productIdentity,
  category: "ethnic/fusion",
  skuName: "mogra",
  productDetails: "product must be a wrinkle free",
  showcasePlan: normalized.creativeDirection.showcasePlan,
});

console.log("\n=== 6 POSES ===");
poses.forEach((p, i) => {
  console.log(`Pose ${i + 1}: [${p.id}] ${p.title}`);
});

const references = [
  { role: "model_identity", label: "MODEL FACE REFERENCE" },
  { role: "front", label: "FRONT PRODUCT" },
  { role: "bottom", label: "BOTTOM WEAR / FARSHI" },
  { role: "back", label: "BACK PRODUCT" },
  { role: "fabric_pattern", label: "FABRIC / PATTERN DETAIL" },
  { role: "additional_product", label: "ADDITIONAL PRODUCT" },
  { role: "style_reference", label: "STYLE REFERENCE" },
];

console.log("\n=== GENERATING PROMPTS FOR ALL 6 POSES ===");
for (let i = 0; i < poses.length; i++) {
  const pose = { ...poses[i], poseNumber: i + 1 };
  const prompt = composeGenerationPrompt({
    skuName: "mogra",
    productDetails: "product must be a wrinkle free",
    pose,
    session: normalized,
    references,
  });

  const m = prompt.match(/LOCKED BOTTOM WEAR[\s\S]*?(?=\n\n[A-Z]|\n[A-Z]{3,}:|$)/);
  console.log(`\n--- POSE ${i + 1} (${pose.title}) BOTTOM WEAR LOCK ---`);
  console.log(m ? m[0].slice(0, 400) + "..." : "NOT FOUND!");

  if (i === 4) { // Pose 5
    const p5 = prompt.match(/POSE 5 HARD RULE[\s\S]*?(?=\n\n[A-Z]|\n[A-Z]{3,}:|$)/);
    console.log(`Pose 5 Hard Rule:`, p5 ? p5[0].slice(0, 200) : "N/A");
  }
  if (i === 5) { // Pose 6
    const p6 = prompt.match(/SHOWCASE FRAME HARD RULE[\s\S]*?(?=\n\n[A-Z]|\n[A-Z]{3,}:|$)/);
    console.log(`Pose 6 Hard Rule:`, p6 ? p6[0].slice(0, 200) : "N/A");
  }
}
