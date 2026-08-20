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
// Removed GenerationTraceViewModel
import { buildGenerationGraph, buildV2GenerationGraph } from './graph/buildGenerationGraph';
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
  data,
  onNodeSelect
}: {
  data: any;
  onNodeSelect: (node: any) => void;
}) {
  const initialData = useMemo(() => {
    let nodes, edges;
    if (data.is_v2) {
      const graph = buildV2GenerationGraph(data);
      nodes = graph.nodes;
      edges = graph.edges;
    } else {
      const graph = buildGenerationGraph(data.trace);
      nodes = graph.nodes;
      edges = graph.edges;
    }
    return layoutGenerationGraph(nodes, edges);
  }, [data]);

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
        deleteKeyCode={null}
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
