import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const metaKey = process.env.META_MODEL_API_KEY;
const openAiKey = process.env.OPENAI_API_KEY;

const supabase = createClient(url, key);

async function main() {
  console.log("Checking environment keys:");
  console.log("- Meta Key present:", Boolean(metaKey));
  console.log("- OpenAI Key present:", Boolean(openAiKey));

  // Load the 7 references from local mogra_images folder or Supabase
  const imgDir = "C:\\Users\\Pawan Shukla\\.gemini\\antigravity-ide\\brain\\dcba45b7-9fd1-4660-ab5d-a119c04aec1e\\mogra_images";
  const files = fs.readdirSync(imgDir).filter(f => f.startsWith("ref_"));
  console.log(`Found ${files.length} reference images locally:`, files);

  // Read the images as base64
  const references = [];
  const roleMapping = [
    { role: "model_identity", label: "MODEL FACE REFERENCE", fileMatch: "ref_model_identity" },
    { role: "front", label: "FRONT PRODUCT", fileMatch: "ref_front" },
    { role: "bottom", label: "BOTTOM WEAR / FARSHI", fileMatch: "ref_bottom" },
    { role: "back", label: "BACK PRODUCT", fileMatch: "ref_back" },
    { role: "fabric_pattern", label: "FABRIC / PATTERN DETAIL", fileMatch: "ref_fabric_pattern" },
    { role: "additional_product", label: "ADDITIONAL PRODUCT PHOTO", fileMatch: "ref_additional_product" },
    { role: "style_reference", label: "STYLE REFERENCE", fileMatch: "ref_style_reference" },
  ];

  for (const item of roleMapping) {
    const filename = files.find(f => f.includes(item.fileMatch));
    if (filename) {
      const fullPath = path.join(imgDir, filename);
      const buf = fs.readFileSync(fullPath);
      references.push({
        role: item.role,
        label: item.label,
        base64: buf.toString("base64"),
        mimeType: "image/jpeg",
        filename
      });
      console.log(`Loaded ${item.label} (${(buf.length / 1024).toFixed(1)} KB)`);
    }
  }

  // Load active fashion knowledge from DB
  const { data: kbRows } = await supabase
    .from("fashion_knowledge_base")
    .select("guidance")
    .eq("id", "8a1075c6-2969-44c4-9f99-a32bbe0a99af")
    .single();

  console.log("Seeded Farshi guidance from DB:", kbRows?.guidance?.slice(0, 150) + "...");
}

main().catch(console.error);
