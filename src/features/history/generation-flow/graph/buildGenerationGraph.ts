import type { GenerationTraceViewModel, TracePose, TraceAttempt } from "./types";
import type { Node, Edge } from "@xyflow/react";

export function parseTrace(rawBackendData: any): GenerationTraceViewModel {
  const summary = rawBackendData.summary;
  const session = rawBackendData.session;
  const rawPoses = rawBackendData.poses || [];
  const aiRuns = rawBackendData.aiRuns || [];
  const qaReviews = rawBackendData.qaReviews || [];
  const learnings = rawBackendData.learnings || (rawBackendData.learning ? [rawBackendData.learning] : []);

  const poses: TracePose[] = rawPoses.map((p: any) => {
    const poseAiRuns = aiRuns.filter((r: any) => r.run_kind === "image_generation" && (r.pose_index === p.pose_index || r.input_summary?.pose === p.pose_index));
    const poseQaReviews = qaReviews.filter((q: any) => q.pose_index === p.pose_index);
    
    const genData = p.generation_data || {};
    const corrections = genData.corrections || [];
    const rejectedAttempts = genData.rejectedAttempts || [];

    const attempts: TraceAttempt[] = [];
    const attemptCount = Math.max(p.attempt_count || 1, rejectedAttempts.length + 1, poseAiRuns.length);

    for (let i = 1; i <= attemptCount; i++) {
      let run = poseAiRuns.find((r: any) => r.attempt_number === i);
      if (!run && poseAiRuns[i - 1]) run = poseAiRuns[i - 1];

      let qa = poseQaReviews.find((q: any) => q.attempt_number === i);
      if (!qa && poseQaReviews[i - 1]) qa = poseQaReviews[i - 1];
      
      const isLast = i === attemptCount;
      const isRejected = !isLast || p.status === "failed";
      const rejectedData = rejectedAttempts[i - 1];
      
      let qaViewModel = undefined;
      if (isLast && p.qa_payload) {
         qaViewModel = {
            pass: p.qa_payload.pass,
            score: p.qa_payload.score,
            failed_checks: p.qa_payload.failed || p.qa_payload.checks || [],
            reason: p.qa_payload.reason,
            correction: p.qa_payload.correction,
         };
      } else if (rejectedData) {
         qaViewModel = {
            pass: false,
            score: rejectedData.score,
            failed_checks: [],
            reason: rejectedData.reason,
            correction: corrections[i - 1],
         };
      } else if (qa) {
         qaViewModel = {
            pass: qa.passed ?? qa.pass,
            score: qa.score,
            failed_checks: qa.issues || qa.failed_checks || [],
            reason: qa.notes || qa.reason,
            correction: qa.correction,
         };
      }

      attempts.push({
        attempt_index: i,
        provider_request_id: run?.provider_request_id || run?.request_id,
        model: run?.model || summary.model,
        provider: run?.provider || summary.provider,
        prompt_tokens: run?.input_tokens || run?.prompt_tokens,
        completion_tokens: run?.output_tokens || run?.completion_tokens,
        cost_usd: run?.cost_usd,
        latency_ms: run?.latency_ms,
        
        output_url: isLast ? p.output_url : (rejectedData?.url || undefined),
        storage_path: isLast ? p.storage_path : (rejectedData?.storagePath || undefined),
        
        qa: qaViewModel,
        
        rejected: isRejected,
        correction: corrections[i - 1] || rejectedData?.correction,
        is_historical_reconstruction: !run?.attempt_number
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
    learning: learnings[0] || null,
    learnings,
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

export function buildV2GenerationGraph(rawBackendData: any) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  
  if (!rawBackendData.nodes) return { nodes, edges };

  // True Node-based parsing
  rawBackendData.nodes.forEach((n: any) => {
    // Map backend node_type to frontend node type
    let type = n.node_type;
    if (type === 'ai_visual_analysis') type = 'analysis';
    if (type === 'product_truth') type = 'truth';
    if (type === 'memory_and_planning') type = 'plan';
    if (type === 'pose_reference') type = 'reference';
    if (type === 'prompt_compilation') type = 'prompt';
    if (type === 'gpt_image_2') type = 'generation';
    if (type === 'gemini_qa') type = 'qa';
    if (type === 'final_image') type = 'complete';

    nodes.push({
      id: n.id,
      type: type,
      data: {
        id: n.id,
        status: n.status,
        inputs: n.inputs,
        outputs: n.outputs,
        started_at: n.started_at,
        completed_at: n.completed_at,
        error_message: n.error_message
      },
      position: { x: 0, y: 0 } // Layout handles this
    });
  });

  rawBackendData.edges.forEach((e: any) => {
    edges.push({
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      type: 'smoothstep',
    });
  });

  return { nodes, edges };
}
