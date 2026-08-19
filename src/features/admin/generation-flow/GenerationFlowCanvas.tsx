import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  BackgroundVariant
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GenerationTraceViewModel } from './graph/types';
import { buildGenerationGraph } from './graph/buildGenerationGraph';
import { layoutGenerationGraph } from './graph/layoutGenerationGraph';
import * as FlowNodes from './nodes';

const nodeTypes = {
  start: FlowNodes.StartNode,
  reference: FlowNodes.ReferenceNode,
  analysis: FlowNodes.AnalysisNode,
  truth: FlowNodes.TruthNode,
  memory: FlowNodes.MemoryNode,
  plan: FlowNodes.PlanNode,
  pose: FlowNodes.PoseNode,
  prompt: FlowNodes.PromptNode,
  generation: FlowNodes.GenerationNode,
  qa: FlowNodes.QaNode,
  correction: FlowNodes.CorrectionNode,
  storage: FlowNodes.StorageNode,
  complete: FlowNodes.CompleteNode,
};

export function GenerationFlowCanvas({
  trace,
  onNodeSelect
}: {
  trace: GenerationTraceViewModel;
  onNodeSelect: (node: any) => void;
}) {
  const initialData = useMemo(() => {
    const { nodes, edges } = buildGenerationGraph(trace);
    return layoutGenerationGraph(nodes, edges);
  }, [trace]);

  const [nodes, , onNodesChange] = useNodesState(initialData.nodes);
  const [edges, , onEdgesChange] = useEdgesState(initialData.edges);

  const handleNodeClick = useCallback((_event: any, node: any) => {
    onNodeSelect(node);
  }, [onNodeSelect]);

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
        nodesConnectable={false}
        elementsSelectable={true}
        minZoom={0.1}
        maxZoom={1.5}
      >
        <Controls />
        <MiniMap />
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
      </ReactFlow>
    </div>
  );
}
