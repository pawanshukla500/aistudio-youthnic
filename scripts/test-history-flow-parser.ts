import { parseTrace } from "../src/features/history/generation-flow/graph/buildGenerationGraph.ts";

function testParseTrace() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (!condition) {
      console.error("❌ FAILED:", message);
      failed++;
    } else {
      console.log("✅ PASSED:", message);
      passed++;
    }
  }

  // 1. 0 learning rows
  const noLearning = parseTrace({ summary: {}, session: null, poses: [], aiRuns: [], qaReviews: [], learnings: [] });
  assert(noLearning.learnings?.length === 0, "Handles 0 learning rows");

  // 2. 1 learning row
  const oneLearning = parseTrace({ summary: {}, session: null, poses: [], aiRuns: [], qaReviews: [], learnings: [{ id: 1 }] });
  assert(oneLearning.learnings?.length === 1 && oneLearning.learning?.id === 1, "Handles 1 learning row");

  // 3. 2+ learning rows
  const multiLearning = parseTrace({ summary: {}, session: null, poses: [], aiRuns: [], qaReviews: [], learnings: [{ id: 2 }, { id: 1 }] });
  assert(multiLearning.learnings?.length === 2 && multiLearning.learning?.id === 2, "Handles 2+ learning rows and extracts latest");

  // 4. Regenerated pose / Unverified QA / Legacy Passed QA
  const trace = parseTrace({
    summary: { model: "default" },
    session: null,
    poses: [
      {
        pose_index: 1,
        status: "completed",
        attempt_count: 2,
        qa_payload: { pass: true, score: 95, failed: [], reason: "Looks good", correction: "" },
        generation_data: {
          rejectedAttempts: [
            { score: 40, reason: "Bad hand", url: "http://bad.jpg", correction: "Fix hand" }
          ]
        }
      }
    ],
    aiRuns: [
      { attempt_number: 1, pose_index: 1, run_kind: "image_generation", provider_request_id: "req-1" },
      { attempt_number: 2, pose_index: 1, run_kind: "image_generation", provider_request_id: "req-2" }
    ],
    qaReviews: []
  });

  const pose = trace.poses[0];
  assert(pose.attempts.length === 2, "Regenerated pose extracts correct number of attempts");
  assert(pose.attempts[0].rejected === true && pose.attempts[0].qa?.score === 40, "Rejected attempt correctly mapped from generation_data");
  assert(pose.attempts[0].output_url === "http://bad.jpg", "Rejected attempt correctly exposes output URL");
  assert(pose.attempts[1].rejected === false && pose.attempts[1].qa?.score === 95, "Final attempt correctly mapped from qa_payload");
  assert(pose.attempts[1].provider_request_id === "req-2", "Attempt correlation properly extracted provider_request_id");

  console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) Deno.exit(1);
}

testParseTrace();
