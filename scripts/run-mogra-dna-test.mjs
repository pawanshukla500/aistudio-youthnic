import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const metaKey = process.env.META_MODEL_API_KEY;
const openAiKey = process.env.OPENAI_API_KEY;
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key);

async function main() {
  console.log("Starting Mogra DNA Extraction Test with updated rules...");

  // 1. Load images locally
  const imgDir = "C:\\Users\\Pawan Shukla\\.gemini\\antigravity-ide\\brain\\dcba45b7-9fd1-4660-ab5d-a119c04aec1e\\mogra_images";
  const files = fs.readdirSync(imgDir).filter(f => f.startsWith("ref_"));

  const roleMapping = [
    { role: "model_identity", label: "MODEL FACE REFERENCE - exact face, hair, skin tone and body-proportion truth; any garment or background in this image is unrelated and must not influence the SKU or set", fileMatch: "ref_model_identity" },
    { role: "front", label: "FRONT PRODUCT - authoritative front garment design and construction ONLY. Pre-shoot background, walls, arches, urns, pots, plants, floor, and location in this image MUST BE 100% DISCARDED; never reproduce them", fileMatch: "ref_front" },
    { role: "bottom", label: "BOTTOM WEAR / FARSHI - pixel-level authority for the trousers/skirt cut, volume, hem, fabric color and print; never copy upper-garment embroidery onto this panel; pre-shoot floor and background must be ignored", fileMatch: "ref_bottom" },
    { role: "back", label: "BACK PRODUCT - authoritative rear garment construction and design ONLY. Pre-shoot background, walls, and setting MUST BE 100% DISCARDED", fileMatch: "ref_back" },
    { role: "fabric_pattern", label: "FABRIC / PATTERN DETAIL - high-priority UPPER-garment texture, weave, print and embroidery truth; not bottom-wear print unless this image itself shows the trousers/skirt; background must be ignored", fileMatch: "ref_fabric_pattern" },
    { role: "additional_product", label: "ADDITIONAL PRODUCT PHOTO - supporting product truth; background must be ignored", fileMatch: "ref_additional_product" },
    { role: "style_reference", label: "STYLE REFERENCE - SOLE AUTHORITY for photoshoot backdrop, room architecture, wall color/texture, flooring, props, composition, mood, and lighting; never product identity or garment. The clothing/outfit in this image must be 100% DISCARDED; dress model ONLY in uploaded product", fileMatch: "ref_style_reference" },
  ];

  const manifest = [];
  const contentItems = [];

  for (let i = 0; i < roleMapping.length; i++) {
    const item = roleMapping[i];
    const filename = files.find(f => f.includes(item.fileMatch));
    if (!filename) throw new Error(`Missing image for ${item.role}`);
    const buf = fs.readFileSync(path.join(imgDir, filename));
    const base64 = buf.toString("base64");
    manifest.push(`IMAGE ${i + 1}: ${item.label}`);
    contentItems.push({ type: "input_text", text: `IMAGE ${i + 1}: ${item.label}` });
    contentItems.push({
      type: "input_image",
      image_url: `data:image/jpeg;base64,${base64}`
    });
  }

  // 2. Fetch Farshi fashion knowledge
  const { data: kbRow } = await supabase
    .from("fashion_knowledge_base")
    .select("guidance")
    .eq("id", "8a1075c6-2969-44c4-9f99-a32bbe0a99af")
    .single();

  const fashionKnowledge = kbRow?.guidance ? `- ${kbRow.guidance}` : "";

  // 3. Construct prompt using the updated profiles.ts rules
  const promptText = `You are the visual merchandiser and shoot planner for a fashion e-commerce studio.

Analyze EVERY supplied image before answering.
${manifest.join("\n")}

REFERENCE AUTHORITY (highest to lowest):
1. MODEL FACE REFERENCE (if supplied) - the exact, non-negotiable face and identity for the model. Overrides any face you would otherwise design.
2. FRONT PRODUCT - legacy authoritative front product design.
3. BACK PRODUCT - legacy authoritative back design; never infer the back from the front.
4. FABRIC / PATTERN DETAIL - legacy high-priority truth for UPPER-garment weave, texture, print, embroidery, stitching, trims, and construction; it does not prove bottom-wear print unless the image itself shows the trousers/skirt.
5. MANNEQUIN / FLAT-LAY SHOT - on a mannequin or dress form, authoritative for worn shape, fit, proportion and drape.
6. BOTTOM WEAR / FARSHI - when supplied, pixel-level authority for the trousers/skirt cut, volume, hem, color and print. Never copy upper-garment embroidery onto this panel.
7. ADDITIONAL PRODUCT - another source of product truth, including supporting bottom-wear evidence.
8. STYLE REFERENCE - creative direction only. From the reference image, take ONLY the photoshoot background/backdrop, model face/style guidance, pose inspiration, framing, and overall photography direction. ABSOLUTE PROHIBITION ON COPYING THE PRODUCT FROM THE STYLE REFERENCE: The clothing, outfit, saree, dress, fabric, color, prints, or embroidery worn by the person in the style reference MUST BE 100% DISCARDED. Absolutely DO NOT copy, reproduce, or borrow the style reference's clothing.

First, determine the garmentFamily from the references: "kurta_or_kurti_set", "saree", "dress", "western_or_casual", or "other".

SKU: mogra
Declared category: ethnic/fusion
User product notes: product must be a wrinkle free
Requested model direction: one consistent professional adult fashion model
Requested scene direction: warm festive South Indian jasmine-decor set

PRINT AND EMBROIDERY GEOMETRY:
- patternGeometry.scale: motif size relative to a body landmark
- patternGeometry.orientation and repeat: the direction bands or motifs run
- patternGeometry.density: how much ground fabric shows between motifs
- patternGeometry.placementByPanel: one entry per panel (body front, body back, sleeves, yoke, bottom wear, dupatta)
- patternGeometry.motifInventory: name each distinct motif shape once
- embroideryGeometry: actual internal construction, borders, scale, and placement

BOTTOM WEAR ARCHITECTURE, SILHOUETTE & PRINT (MANDATORY FOR SUITS, SETS, & CO-ORDS):
When the product is a multi-piece outfit (kurti/kurta set, salwar suit, co-ord set, lehenga, Indo-western), the customer buys the complete set and expects the EXACT bottom wear cut, silhouette, color, and pattern shown in the product references. NEVER gloss over bottom wear with generic words like "matching pants". You MUST inspect the bottom wear in FRONT PRODUCT, BACK PRODUCT, MANNEQUIN / FLAT-LAY, ADDITIONAL PRODUCT, and BOTTOM WEAR / FARSHI references (if supplied) and record an exhaustive, specific specification in 'productIdentity.bottomWearDetails'. FABRIC / PATTERN DETAIL is NOT authority for bottoms unless that image itself shows the trousers/skirt.

AUTHORITATIVE FARSHI CUT DIRECTIVE:
A dedicated "BOTTOM WEAR / FARSHI" reference is present in the manifest (or this SKU is designated Farshi).
The bottom wear in this SKU is AUTHORITATIVELY CLASSIFIED AS "Farshi / Farshi Pajama / Farshi Pants" (NEVER Palazzo).
Its true cut features voluminous flared trousers with TWO DISTINCT LEGS, vertical gathers/pleats or wide A-line flared drape from hip/waist down to hem, whether ankle-length (clearing the floor to display traditional footwear/juttis) or floor-length, with sequin lace hem trim.
You MUST record 'productIdentity.bottomWearDetails.classification' as "Farshi / Farshi Pajama / Farshi Pants".
You are STRICTLY FORBIDDEN from classifying it as Palazzo, and you must NEVER write "NOT Farshi".
Under negativeConstraints, explicitly state: "NOT palazzo, NOT tubular straight pants, NOT lehenga, NOT skirt, NOT sharara, NOT gharara, NOT churidar".

1. EXACT CUT & CLASSIFICATION: Explicitly classify the cut from the worn silhouette in the references, not from a generic ethnic-wear prior:
   - "Farshi / Farsi / Farshi Pajama / Farshi Pants": Voluminous flared trousers with TWO DISTINCT LEGS (never a lehenga or circular skirt). Heavy vertical pleating, gathers, or wide A-line flared drape from waist/hip creates architectural volume that flares prominently towards the hem. Length may be ankle-length (clearing the floor to display traditional footwear/juttis), floor-length, or floor-trailing/pooling. Hemline often features an embellished border, sequin lace trim, or print band. Classify based on flared volume, two-leg structure, and pleat/gather drape. Distinct from basic straight/tubular palazzo (which lacks flared volume and waist pleats/gathers) and from Sharara (where flare begins at or below a knee join seam). When a dedicated BOTTOM WEAR / FARSHI reference is supplied or the trousers show flared volume with pleats/gathers/hem lace, classify as Farshi / Farshi Pajama / Farshi Pants, NOT palazzo.
   - "Palazzo": Simple standard-width straight or softly flared wide-leg trousers without farshi flared volume, gathers, or architectural flair. If a BOTTOM WEAR / FARSHI reference is attached or flared volume/lace is present, DO NOT classify as Palazzo.
   - "Straight Trousers / Cigarette Pants": Narrow straight tailored cut ending at the ankle, with side slits or plain hem.
   - "Sharara": Fitted from waist to knee, flaring out dramatically from the knee down.
   - "Gharara": Ruched/gathered below the knee with decorative gote/piping, flaring out below.
   - "Patiala / Salwar": Traditional pleated volume draped into narrow ankle cuff (poncha).
   - "Churidar": Fitted closely to calf and ankle with fabric gathers/rings (churis) at the ankle.
   - "Skirt / Lehenga": Full-length circular or pleated flare with NO separate trouser legs.
2. WAIST & PLEATING ARCHITECTURE: Document pleat structure: e.g., "deep front inverted box pleats running vertically down each leg", "dense gathers from a fitted waistband", "knife pleats", or "gather-free tailored waist".
3. LEG VOLUME & SILHOUETTE: Describe the leg profile from hip to hem, including whether fabric trails/pools or clears the floor at the ankles. Farshi must be described as extreme volume with two visible legs, not as "wide-leg pants".
4. HEMLINE & BORDER FINISH: Document the hem finish actually visible: e.g., "broad 3 to 4 inch horizontal hem band", "sequin lace trim above hem", "plain turned hem", "metallic zari border". Do not invent a hem band.
5. FABRIC, COLOR & MOTIF GEOMETRY: Record bottom-wear fabric, base color, sheen, AND print/patterns as its own geometry - motif shape inventory, physical scale relative to the leg (e.g. "each gold floral is roughly palm-sized, scattered not micro-dotted", or "bold dark chocolate-brown chevron / zigzag print on beige ground stacked vertically across each leg"), density, metallic color, orientation, and hem embellishments (e.g. sequin lace band or contrast border). Example: "dark chocolate-brown on beige ground with bold large-scale chevron zigzag print running across both legs, finished with gold sequin lace above the hem; NOT solid; NOT micro-dots; NOT upper kurta floral". If the kurta is floral and the bottoms have a chevron zigzag or floral boota, those are TWO different treatments - never merge them.
6. EXPLICIT NEGATIVE CONSTRAINTS (WHAT IT IS NOT):
   - For Farshi / Farsi pajama / Farshi pants: Explicitly state "NOT palazzo, NOT plain wide-leg, NOT lehenga, NOT tubular straight pants, NOT skirt, NOT dhoti pants, NOT tulip pants, NOT tapered at ankle, NOT gathered into an ankle cuff, NOT balloon/harem pants, NOT churidar". Also state "NOT solid/undecorated" when motifs are visible, and "NOT micro-dot/speckle print" when motifs or chevron prints are bold.
   - For Palazzo: Explicitly state "NOT lehenga, NOT dhoti pants, NOT tulip pants, NOT tapered at ankle". NEVER state "NOT Farshi" when an image is labeled BOTTOM WEAR / FARSHI.

FASHION KNOWLEDGE (SEEDED CUT/PRINT GUIDANCE, SUBORDINATE TO PRODUCT REFERENCES):
${fashionKnowledge}

CRITICAL RULES FOR REALISTIC GENERATION:
- Exactly two arms and two hands: Zero third hands, duplicate wrists, or floating limbs.
- The clothing worn in the style reference MUST be 100% ignored.
- Return STRICT JSON conforming to the studio product analysis schema with productIdentity, creativeDirection, modelIdentity, stylingPlan, and posePlan.`;

  contentItems.push({ type: "input_text", text: promptText });

  console.log("Calling Meta Muse Spark 1.3 Contributor...");
  let text = "";
  try {
    let response = await fetch("https://api.meta.ai/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${metaKey}`,
      },
      body: JSON.stringify({
        model: "muse-spark-1.3-contributor",
        input: [{ role: "user", content: contentItems }],
        reasoning: { effort: "low" },
        max_output_tokens: 16384,
      }),
    });

    if (!response.ok) {
      console.log(`Meta returned ${response.status}. Retrying muse-spark-1.2-contributor...`);
      response = await fetch("https://api.meta.ai/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${metaKey}`,
        },
        body: JSON.stringify({
          model: "muse-spark-1.2-contributor",
          input: [{ role: "user", content: contentItems }],
          reasoning: { effort: "low" },
          max_output_tokens: 16384,
        }),
      });
    }

    if (response.ok) {
      const data = await response.json();
      fs.writeFileSync("scripts/raw_meta_response.json", JSON.stringify(data, null, 2), "utf8");
      
      // Exact extractor from index.ts
      const direct = String(data.output_text || "").trim();
      if (direct) {
        text = direct;
      } else if (Array.isArray(data.output)) {
        text = data.output.flatMap((item) => {
          if (typeof item.text === "string" && item.text.trim()) return [item.text.trim()];
          if (typeof item.output_text === "string" && item.output_text.trim()) return [item.output_text.trim()];
          if (typeof item.content === "string" && item.content.trim()) return [item.content.trim()];
          if (Array.isArray(item.content)) {
            return item.content
              .map((c) => String(c.text || c.output_text || (typeof c === "string" ? c : "")).trim())
              .filter(Boolean);
          }
          const message = item.message;
          if (message && typeof message.content === "string" && message.content.trim()) return [message.content.trim()];
          return [];
        }).join("\n").trim();
      }
      console.log(`Extracted text length from Meta: ${text.length}`);
    } else {
      console.log("Meta API failed with status:", response.status, await response.text());
    }
  } catch (err) {
    console.error("Meta API error:", err);
  }

  // Fallback to OpenAI if Meta fails or returns empty
  if (!text && openAiKey) {
    console.log("Falling back to OpenAI Chat Completion API...");
    const oaiChatContent = contentItems.map(item => {
      if (item.type === "input_image") {
        return { type: "image_url", image_url: { url: item.image_url } };
      }
      return { type: "text", text: item.text };
    });

    const oaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: oaiChatContent }],
        max_tokens: 4096,
        response_format: { type: "json_object" },
      }),
    });
    if (oaiRes.ok) {
      const data = await oaiRes.json();
      text = data.choices?.[0]?.message?.content || "";
    } else {
      console.error("OpenAI failed:", oaiRes.status, await oaiRes.text());
    }
  }

  // Parse JSON
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let json;
  try {
    json = JSON.parse(cleaned);
  } catch (e) {
    console.error("JSON parse error:", e.message);
    fs.writeFileSync("scripts/raw_analysis_response.txt", text, "utf8");
    return;
  }

  fs.writeFileSync("scripts/new_mogra_analysis.json", JSON.stringify(json, null, 2), "utf8");
  console.log("Successfully obtained new analysis JSON!");
  console.log("=== RESULTS ===");
  console.log("garmentFamily:", json.productIdentity?.garmentFamily);
  console.log("bottomWearDetails:", json.productIdentity?.bottomWearDetails);
  console.log("pattern:", json.productIdentity?.pattern);
  console.log("silhouette:", json.productIdentity?.silhouette);
  console.log("showcasePlan:", json.creativeDirection?.showcasePlan);
  if (json.posePlan) {
    if (Array.isArray(json.posePlan)) {
      console.log("Pose Plan Titles:", json.posePlan.map(p => `${p.poseNumber || p.id}: ${p.title}`));
    } else {
      console.log("Pose Plan:", Object.keys(json.posePlan));
    }
  }
}

main().catch(console.error);
