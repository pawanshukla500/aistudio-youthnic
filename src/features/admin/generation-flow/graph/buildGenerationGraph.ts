import type { GenerationTraceViewModel, TracePose, TraceAttempt } from "./types";
import type { Node, Edge } from "@xyflow/react";

export function parseTrace(rawBackendData: any): GenerationTraceViewModel {
  const summary = rawBackendData.summary;
  const session = rawBackendData.session;
  const rawPoses = rawBackendData.poses || [];
  const aiRuns = rawBackendData.aiRuns || [];
  const qaReviews = rawBackendData.qaReviews || [];
  const learning = rawBackendData.learning || null;

  const poses: TracePose[] = rawPoses.map((p: any) => {
    const poseAiRuns = aiRuns.filter((r: any) => r.run_kind === "image_generation" && (r.pose_index === p.pose_index || r.input_summary?.pose === p.pose_index));
    const poseQaReviews = qaReviews.filter((q: any) => q.pose_index === p.pose_index);
    
    // session_generations.generation_data might contain corrections/rejected attempts
    const genData = p.generation_data || {};
    const corrections = genData.corrections || [];

    const attempts: TraceAttempt[] = [];
    const attemptCount = p.attempt_count || 1;

    for (let i = 1; i <= attemptCount; i++) {
      const run = poseAiRuns[i - 1]; // Assume ordered
      const qa = poseQaReviews[i - 1]; // Assume ordered
      
      const isLast = i === attemptCount;
      // Every attempt before the last one was rejected. A failed pose also rejects the last attempt.
      const isRejected = !isLast || p.status === "failed";
      
      attempts.push({
        attempt_index: i,
        provider_request_id: run?.request_id,
        model: run?.model || summary.model,
        provider: run?.provider || summary.provider,
        prompt_tokens: run?.prompt_tokens,
        completion_tokens: run?.completion_tokens,
        cost_usd: run?.cost_usd,
        latency_ms: run?.latency_ms,
        
        output_url: isLast ? p.output_url : undefined, // Historic rejected image URLs might not be stored cleanly
        storage_path: isLast ? p.storage_path : undefined,
        
        qa: qa ? {
          pass: qa.pass,
          score: qa.score,
          failed_checks: qa.failed_checks,
          reason: qa.reason,
          correction: qa.correction,
        } : undefined,
        
        rejected: isRejected,
        correction: corrections[i - 1],
      });
    }

    return {
      pose_index: p.pose_index,
      title: p.title,
      status: p.status,
      qa_status: p.qa_status,
      full_prompt: p.full_prompt,
      attempts,
      final_output_url: p.output_url,
    };
  });

  return {
    summary,
    session,
    poses,
    learning,
  };
}

export function buildGenerationGraph(trace: GenerationTraceViewModel) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let idCounter = 1;
  const newId = (prefix: string) => `${prefix}-${idCounter++}`;

  const addNode = (id: string, type: string, data: any, _level: number, parentId?: string) => {
    nodes.push({
      id,
      type,
      data,
      position: { x: 0, y: 0 } // Layout handles this
    });
    if (parentId) {
      edges.push({
        id: `e-${parentId}-${id}`,
        source: parentId,
        target: id,
        type: 'smoothstep',
      });
    }
    return id;
  };

  const startId = addNode(newId('start'), 'start', { summary: trace.summary }, 0);
  // Reference node omitted until API supplies reference data
  const analysisId = addNode(newId('analysis'), 'analysis', { session: trace.session }, 4, startId);
  const truthId = addNode(newId('truth'), 'truth', { productIdentity: trace.session?.productIdentity }, 3, analysisId);
  
  const memoryId = addNode(newId('memory'), 'memory', { learning: trace.learning }, 4, truthId);
  const planId = addNode(newId('plan'), 'plan', { posePlan: trace.session?.posePlan }, 5, memoryId);

  // Poses
  trace.poses.forEach((pose) => {
    const poseId = addNode(newId(`pose-${pose.pose_index}`), 'pose', { pose }, 6, planId);
    
    let currentId = poseId;
    if (pose.full_prompt) {
      currentId = addNode(newId(`prompt-${pose.pose_index}`), 'prompt', { prompt: pose.full_prompt }, 7, currentId);
    }
    
    pose.attempts.forEach((attempt, aIdx) => {
      const genId = addNode(newId(`gen-${pose.pose_index}-${aIdx}`), 'generation', { attempt, poseTitle: pose.title }, 8 + aIdx * 3, currentId);
      currentId = genId;
      
      if (attempt.qa) {
        const qaId = addNode(newId(`qa-${pose.pose_index}-${aIdx}`), 'qa', { qa: attempt.qa, poseTitle: pose.title }, 9 + aIdx * 3, currentId);
        currentId = qaId;
      }
      
      if (attempt.correction) {
        const corrId = addNode(newId(`correction-${pose.pose_index}-${aIdx}`), 'correction', { correction: attempt.correction }, 10 + aIdx * 3, currentId);
        currentId = corrId;
      }
    });
    
    addNode(newId(`complete-${pose.pose_index}`), 'complete', { status: pose.status, output: pose.final_output_url }, 20, currentId);
  });

  return { nodes, edges };
}
