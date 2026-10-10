import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);
const FUNCTION_URL = "https://functions-production-b062.up.railway.app/app-api";

async function kickWorker(jobId) {
  try {
    const res = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ operation: "worker", args: jobId ? { jobId } : {} }),
    });
    const text = await res.text();
    return text;
  } catch (err) {
    console.error("Error kicking worker:", err.message);
    return null;
  }
}

async function main() {
  console.log("=== STARTING ISOLATED 6-POSE MOGRA GENERATION ===");

  // 1. Load original Mogra inspection data to obtain references and user metadata
  const originalData = JSON.parse(fs.readFileSync("scripts/mogra_job_inspection.json", "utf8"));
  const originalJob = originalData.job;
  const references = originalJob.job_data.references;
  const orgId = originalJob.org_id; // "7d56360f-2c96-4eb2-923e-f22b7fe36605"
  const userId = originalJob.user_id; // "D2eIkaAjdJfoqptzOr4I06I4uo73"
  const userEmail = originalJob.user_email; // "returnorders@vbexports.co.in"

  // 2. Load verified Farshi analysis DNA from new_mogra_analysis.json
  const verifiedAnalysis = JSON.parse(fs.readFileSync("scripts/new_mogra_analysis.json", "utf8"));

  // 3. Generate distinct IDs for strict non-destructive isolation
  const newPlanningRequestId = crypto.randomUUID();
  const newSessionId = `session_${crypto.randomUUID()}`;
  const newJobId = `job_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  console.log(`[Setup] Isolated Planning Request ID: ${newPlanningRequestId}`);
  console.log(`[Setup] Isolated Session ID: ${newSessionId}`);
  console.log(`[Setup] Isolated Job ID: ${newJobId}`);

  // 4. Create new isolated planning request record
  const { error: reqErr } = await supabase.from("planning_requests").insert({
    id: newPlanningRequestId,
    organization_id: orgId,
    created_by_member_id: "517c61ed-19f1-454b-8490-d496574bb2fa",
    sku_name: "mogra",
    product_description: "product must be a wrinkle free",
    photoshoot_type: "ai_catalog_5_pose",
    category: "ethnic/fusion",
    status: "analyzed",
    generation_status: "queued",
    created_at: now,
    updated_at: now,
  });
  if (reqErr) throw new Error(`Failed to create planning_request: ${reqErr.message}`);
  console.log("[Setup] Planning request created successfully.");

  // 5. Create planning_assets for the references linked to this new planning request
  for (const ref of references) {
    await supabase.from("planning_assets").insert({
      organization_id: orgId,
      planning_request_id: newPlanningRequestId,
      sku_name: "mogra",
      asset_role: ref.role,
      image_url: ref.downloadUrl,
      storage_path: ref.storagePath,
      storage_backend: ref.storageBackend || "firebase",
      sku_matched: true,
      metadata: {
        filename: ref.filename,
        hash: ref.hash,
        size: ref.size,
        mimeType: ref.mimeType,
      },
      created_at: now,
    });
  }
  console.log(`[Setup] Registered ${references.length} reference assets.`);

  // 6. Build the 6-pose plan using the updated garment poses
  const posePlan = [
    {
      id: "full_front",
      title: "Hero Front",
      prompt: "photorealistic full-body frontal hero of adult South Asian female model, oval face warm medium skin dark brown almond eyes arched brows straight nose full pink lips matching reference, dark hair in sleek center-part low bun with small white gajra, natural dewy makeup. Wearing mustard yellow straight short kurta with white marigold floral block print and small white dots, V-neck, 3/4 bell sleeves with dark-brown chevron cuff plus gold sequin lace trim. Paired with dark chocolate-brown and beige bold chevron zigzag Farshi pants with two distinct voluminous flared legs, ankle-length clearing floor to display traditional footwear/juttis with gold sequin lace band above hem. Long striped dupatta over shoulder. Gold mojari juttis, small antique gold jhumkas, gold bangles. Standing straight facing camera, left hand holding dupatta, right relaxed, gentle natural smile. Wrinkle-free fabric, natural skin pores, exactly two arms two hands.",
      enabled: true,
      framing: "full body head-to-toe with headroom",
      purpose: "establish identity, styling, set anchor",
      expression: "gentle authentic smile, soft lips, direct lens",
      cameraAngle: "eye-level straight on",
      description: "head-to-toe square frontal hero",
      bodyPosition: "standing straight, balanced weight, feet slightly apart, torso square to camera",
      handPlacement: "left hand lightly holding dupatta edge, right arm relaxed by side",
      consistencyNotes: "locks wall, floor, lighting, footwear, jewellery for all poses",
      primaryReference: "front",
      highlightedDetails: ["V-neck floral print", "sleeve cuff border", "Farshi voluminous two legs ankle-length", "striped dupatta drape"],
      productVisibilityRules: ["full kurta length visible", "both sleeves visible", "Farshi waist-to-hem visible with two distinct flared legs and juttis", "dupatta off yoke"],
    },
    {
      id: "angled",
      title: "Three-quarter Turn",
      prompt: "photorealistic full-body three-quarter view of same adult South Asian female model, oval face warm medium skin dark almond eyes full lips, dark hair low bun with gajra, dewy makeup, turned 40 degrees with left foot forward. Wearing same mustard yellow V-neck short kurta with white marigold floral print, 3/4 bell sleeves with chevron cuff and gold lace, dark-brown and beige bold chevron zigzag Farshi pants with two distinct wide flared legs ankle-length showing gold mojari juttis and gold sequin lace above hem, two-tone striped dupatta over shoulder, gold jhumkas and bangles. Right hand holding dupatta, left relaxed, soft natural smile. Wrinkle-free fabric, natural skin texture, exactly two arms two hands.",
      enabled: true,
      framing: "full body head-to-toe",
      purpose: "prove fit, depth, side drape",
      expression: "soft glance following angle, authentic soft smile",
      cameraAngle: "eye-level, model turned 40 degrees to camera right",
      description: "35-45 degree turned view showing side depth",
      bodyPosition: "torso and hips turned 40 deg, left foot stepped forward, weight on back leg",
      handPlacement: "right hand holding dupatta fold, left arm relaxed",
      consistencyNotes: "same model, styling, footwear, set as hero",
      primaryReference: "front",
      highlightedDetails: ["side seam fall", "sleeve silhouette", "Farshi flared volume from hip to hem", "dupatta flow"],
      productVisibilityRules: ["side construction visible", "both legs of Farshi pants distinctly readable", "sleeve flare visible"],
    },
    {
      id: "back",
      title: "Rear View",
      prompt: "photorealistic full-body rear view of same adult South Asian female model, warm medium skin, dark hair swept forward over front shoulder to fully expose back, wearing same mustard yellow short kurta with white marigold floral all-over back print straight hem, 3/4 bell sleeves with chevron cuff and gold lace, dark-brown and beige bold chevron zigzag Farshi pants with two distinct wide flared legs and gold sequin lace above hem seen from back, ankle-length clearing floor to display gold mojari juttis, striped dupatta held forward over arms so back is fully unobstructed. Standing with back to camera shoulders level, calm poise. Wrinkle-free, natural skin, exactly two arms two hands.",
      enabled: true,
      framing: "full body head-to-toe from back",
      purpose: "prove rear construction",
      expression: "face in profile slightly turned, calm composed",
      cameraAngle: "eye-level straight from behind",
      description: "true rear head-to-toe",
      bodyPosition: "back fully to camera, shoulders level, standing straight",
      handPlacement: "dupatta pulled forward over arms to expose back, hands lightly holding dupatta ends in front",
      consistencyNotes: "same room, lighting, model, footwear",
      primaryReference: "back",
      highlightedDetails: ["back floral print", "back hem", "Farshi back chevron flare", "dupatta stripes from back"],
      productVisibilityRules: ["rear kurta panel 100% unobstructed", "no dupatta covering back embroidery/print", "hair swept forward"],
    },
    {
      id: "creative",
      title: "Walking Movement",
      prompt: "photorealistic dynamic full-body editorial movement frame of same adult South Asian female model, oval face warm medium skin dark almond eyes full lips, dark hair low bun with gajra, dewy makeup. Mid-stride graceful walking movement toward camera right. Wearing same mustard yellow V-neck floral kurta, bell sleeves with chevron cuffs, dark-brown and beige bold chevron zigzag Farshi pants with both voluminous flared legs swirling dynamically while clearly maintaining two distinct legs, ankle-length revealing gold mojari juttis and gold sequin lace band. Striped dupatta billowing softly. One hand lightly guiding dupatta fold, joyful candid smile. Wrinkle-free fabric, natural skin pores, exactly two arms two hands.",
      enabled: true,
      framing: "full body in motion including floor and feet",
      purpose: "lifestyle motion and authentic fabric drape",
      expression: "radiant warm genuine smile, lively",
      cameraAngle: "eye-level straight",
      description: "graceful dynamic walking stride showing Farshi drape and flare",
      bodyPosition: "walking stride, leading foot forward, weight shifting, Farshi pants flowing with architectural flare",
      handPlacement: "one hand lightly holding dupatta edge, other arm moving naturally with stride",
      consistencyNotes: "same set, props, styling, footwear, lighting",
      primaryReference: "front",
      highlightedDetails: ["Farshi movement flare and two-leg separation", "kurta drape in motion", "dupatta flow", "juttis visible"],
      productVisibilityRules: ["two distinct Farshi legs readable during motion", "no skirt or lehenga fusion", "both hems readable"],
    },
    {
      id: "closeup",
      title: "Neckline Detail Closeup",
      prompt: "photorealistic tight crop portrait face to mid-torso of same adult South Asian female model, oval face warm medium skin dark almond eyes arched brows full pink lips, dark hair in sleek center-part low bun with white jasmine gajra, dewy makeup, antique gold jhumkas. Focus on mustard yellow cotton V-neck kurta with white marigold floral block print motifs and small white dots, clean neckline finish, striped dupatta edge beside shoulder, 3/4 bell sleeve cuffs with dark-brown chevron band and gold sequin lace visible at bottom of frame, gold bangles. Hands gently positioned, soft natural smile to lens. Ultra sharp textile weave, wrinkle-free, natural skin pores, correct anatomy with exactly two hands.",
      enabled: true,
      framing: "face_and_detail: face to waist tight crop",
      purpose: "sell primary kurta print and neckline craft",
      expression: "soft warmth, gentle lips, relaxed eyes to lens",
      cameraAngle: "eye-level close",
      description: "face-to-chest crop selling print and neckline",
      bodyPosition: "torso square, hands lightly visible showing cuffs and bangles",
      handPlacement: "hands gently positioned below chest showing sleeve cuff chevron lace",
      consistencyNotes: "same face, makeup, jewellery",
      primaryReference: "fabric_pattern",
      highlightedDetails: ["V-neckline construction", "white marigold block print detail", "dupatta stripe edge", "sleeve cuff lace"],
      productVisibilityRules: ["face sharp plus large readable print area", "neckline craft in sharp focus", "signature craftsmanship highlighted"],
    },
    {
      id: "showcase",
      title: "Farshi and Dupatta Signature Showcase",
      prompt: "photorealistic full-body fashion showcase frame of same adult South Asian female model, oval face warm medium skin dark almond eyes, low bun with gajra, dewy makeup. Diverging signature presentation pose: model standing with feet spaced shoulder-width apart, holding dupatta spread wide with both hands to display the full two-tone stripe artwork, prominently showcasing the dark chocolate-brown and beige bold chevron zigzag Farshi pants in full architectural flared volume with two distinct wide legs, pleated waist drape, straight hem with gold sequin lace band, and ankle-length cut cleanly revealing gold embroidered mojari juttis on patterned carpet. Mustard yellow short kurta visible underneath. Confident proud fashion smile. Wrinkle-free fabric, natural skin texture, exactly two arms two hands.",
      enabled: true,
      framing: "full body head-to-toe with generous floor framing",
      purpose: "showcase signature Farshi silhouette, chevron print, and dupatta drape",
      expression: "confident elegant editorial expression, direct gaze",
      cameraAngle: "slight low fashion angle, eye to waist level",
      description: "diverging showcase pose highlighting bottom wear volume and dupatta craft",
      bodyPosition: "feet spaced shoulder-width apart, balanced stance displaying wide Farshi flare and two distinct legs",
      handPlacement: "both hands holding dupatta ends out to side, exactly two hands, visible arms",
      consistencyNotes: "same model identity, set decor, props, carpet, and lighting",
      primaryReference: "bottom",
      highlightedDetails: ["Farshi extreme flared volume with two distinct separated legs", "bold chevron zigzag pattern alignment", "gold sequin lace hemline", "ankle-length cut revealing gold juttis", "striped dupatta full spread"],
      productVisibilityRules: ["both Farshi legs fully visible without overlap", "chevron print high contrast and sharp", "juttis clearly visible on floor", "not tubular straight pants, not palazzo"],
    },
  ];

  // 7. Assemble session data with verified Farshi DNA
  const sessionData = {
    skuId: "mogra",
    skuName: "mogra",
    category: "ethnic/fusion",
    productDetails: "product must be a wrinkle free",
    bottomWearMode: "auto",
    references,
    productIdentity: {
      ...verifiedAnalysis.productIdentity,
      garmentFamily: "kurta_or_kurti_set",
      mainColor: "mustard yellow",
      bottomWearDetails: verifiedAnalysis.productIdentity.bottomWearDetails,
    },
    creativeDirection: verifiedAnalysis.creativeDirection,
    modelIdentity: verifiedAnalysis.modelIdentity,
    stylingPlan: verifiedAnalysis.stylingPlan,
    posePlan,
    productDnaVersion: "generation-session-v23-farshi-flared-fidelity",
  };

  const analysisFingerprint = crypto.createHash("sha256").update(JSON.stringify(sessionData)).digest("hex").slice(0, 8);

  // 8. Insert catalog_session
  const { error: sessionErr } = await supabase.from("catalog_sessions").insert({
    session_id: newSessionId,
    job_id: newJobId,
    user_id: userId,
    organization_id: orgId,
    planning_request_id: newPlanningRequestId,
    status: "generating",
    analysis_fingerprint: analysisFingerprint,
    product_hash: "p_mogra_farshi_v2",
    reference_hash: "r_mogra_farshi_v2",
    session_data: sessionData,
    created_at: now,
    updated_at: now,
  });
  if (sessionErr) throw new Error(`Failed to create catalog_session: ${sessionErr.message}`);
  console.log("[Setup] Catalog session created successfully.");

  // 9. Insert generation_job
  const jobRow = {
    job_id: newJobId,
    user_id: userId,
    user_email: userEmail,
    org_id: orgId,
    status: "queued",
    readiness_status: "ready",
    readiness_reasons: [],
    sku_name: "mogra",
    session_id: newSessionId,
    planning_request_id: newPlanningRequestId,
    total_poses: 6,
    completed_poses: 0,
    failed_poses: 0,
    provider: "openai",
    model: "gpt-image-2",
    aspect_ratio: "4:5",
    image_size: "2K",
    quality: "medium",
    pose_qa: false,
    estimated_cost_usd: 1.02,
    actual_cost_usd: 0,
    source_type: "studio",
    job_data: {
      skuId: "mogra",
      skuName: "mogra",
      category: "ethnic/fusion",
      references,
      bottomWearMode: "auto",
      productDetails: "product must be a wrinkle free",
      requestedModel: null,
      backgroundStyle: "Infer a premium consistent scene from the uploaded style reference",
      analysisFingerprint,
      imageGenerationPolicy: {
        model: "gpt-image-2",
        source: "organization",
        purpose: "image_generation",
        provider: "openai",
        revision: 15,
        thinkingLevel: "none",
      },
      modelIdentityDirection: "Same adult South Asian female fashion model across every pose",
    },
    created_at: now,
    updated_at: now,
  };

  const { error: jobErr } = await supabase.from("generation_jobs").insert(jobRow);
  if (jobErr) throw new Error(`Failed to create generation_job: ${jobErr.message}`);
  console.log("[Setup] Generation job created successfully.");

  // 10. Insert 6 session_generations rows
  const poseRows = posePlan.map((pose, index) => ({
    session_id: newSessionId,
    generation_id: `${newJobId}:pose:${index + 1}`,
    pose_index: index + 1,
    title: pose.title,
    pose_type: pose.id,
    instructions: pose.prompt,
    status: "queued",
    attempt_count: 0,
    generation_data: { ...pose, poseNumber: index + 1, jobId: newJobId },
    created_at: now,
    updated_at: now,
  }));

  const { error: posesErr } = await supabase.from("session_generations").insert(poseRows);
  if (posesErr) throw new Error(`Failed to insert session_generations: ${posesErr.message}`);
  console.log("[Setup] All 6 session_generations rows inserted with status: queued.");

  // 11. Kick the worker and begin monitoring
  console.log("\n[Kickoff] Sending initial kick to worker on Railway functions endpoint...");
  const initialKick = await kickWorker(newJobId);
  console.log(`[Kickoff] Worker acknowledged: ${initialKick}`);

  // Create local directory for outputs
  const outputDir = path.resolve("mogra_farshi_verified");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // 12. Polling Loop
  console.log("\n[Monitoring] Polling generation progress...");
  let completedPoses = 0;
  let failedPoses = 0;
  let attempts = 0;
  const maxAttempts = 60; // 60 * 10s = 10 minutes timeout

  while (attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 10000));
    attempts++;

    const { data: currentJob } = await supabase
      .from("generation_jobs")
      .select("status, current_pose, completed_poses, failed_poses, actual_cost_usd, error_message")
      .eq("job_id", newJobId)
      .single();

    const { data: currentPoses } = await supabase
      .from("session_generations")
      .select("pose_index, title, status, output_url, error")
      .eq("session_id", newSessionId)
      .order("pose_index");

    const completed = (currentPoses || []).filter((p) => p.status === "completed");
    const processing = (currentPoses || []).filter((p) => p.status === "processing");
    const queued = (currentPoses || []).filter((p) => p.status === "queued");
    const failed = (currentPoses || []).filter((p) => p.status === "failed");

    console.log(
      `[T+${attempts * 10}s] Job Status: ${currentJob?.status} | Done: ${completed.length}/6 | In-flight: ${processing.length} | Queued: ${queued.length} | Failed: ${failed.length}`
    );

    for (const c of completed) {
      const localFile = path.join(outputDir, `pose_${c.pose_index}_${c.title.replace(/[^a-zA-Z0-9]/g, "_")}.jpg`);
      if (!fs.existsSync(localFile) && c.output_url) {
        console.log(`[Download] Downloading Pose ${c.pose_index}: ${c.title}...`);
        try {
          const imgRes = await fetch(c.output_url);
          const buf = Buffer.from(await imgRes.arrayBuffer());
          fs.writeFileSync(localFile, buf);
          console.log(`[Saved] -> ${localFile} (${buf.length} bytes)`);
        } catch (err) {
          console.error(`Failed to download Pose ${c.pose_index}: ${err.message}`);
        }
      }
    }

    if (currentJob?.status === "completed" || completed.length === 6) {
      console.log("\n*** ALL 6 POSES COMPLETED SUCCESSFULLY! ***");
      break;
    }

    if (currentJob?.status === "failed" || failed.length > 0) {
      console.error(`Job encountered failure: ${currentJob?.error_message || failed[0]?.error}`);
      break;
    }

    // If no pose is processing and some are still queued, kick the worker again
    if (processing.length === 0 && queued.length > 0) {
      console.log("[Worker Nudge] Nudging worker to continue next pose...");
      await kickWorker(newJobId);
    }
  }

  console.log("\n=== GENERATION RUN COMPLETE ===");
  console.log(`Results saved in: ${outputDir}`);
}

main().catch((err) => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
