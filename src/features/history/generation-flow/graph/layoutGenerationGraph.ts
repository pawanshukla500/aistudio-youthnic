import type { Node, Edge } from "@xyflow/react";

export function layoutGenerationGraph(nodes: Node[], edges: Edge[]) {
  // A simple deterministic layout for Phase 1.
  // Main workflow vertically.
  // Poses branch horizontally.
  // Under each pose, the attempts chain vertically.
  const horizontalSpacing = 300;
  const verticalSpacing = 150;

  const layoutedNodes = [...nodes];
  
  // Base linear flow
  const linearFlowTypes = ['start', 'reference', 'analysis', 'truth', 'memory', 'plan'];
  
  let yPos = 0;
  linearFlowTypes.forEach((type) => {
    const node = layoutedNodes.find(n => n.type === type);
    if (node) {
      node.position = { x: 0, y: yPos };
      yPos += verticalSpacing;
    }
  });

  // Now, the branches start from 'plan' or the last linear node.
  // Let's identify the branches. 
  // Each pose and its descendants will be assigned a column index.
  const poseNodes = layoutedNodes.filter(n => n.type === 'pose').sort((a, b) => {
    return ((a.data?.pose as any)?.pose_index || 0) - ((b.data?.pose as any)?.pose_index || 0);
  });

  const totalBranches = poseNodes.length;
  const startX = -((totalBranches - 1) * horizontalSpacing) / 2;

  poseNodes.forEach((poseNode, colIndex) => {
    const baseX = startX + colIndex * horizontalSpacing;
    let currentY = yPos;
    
    // Position the pose node
    poseNode.position = { x: baseX, y: currentY };
    
    // Find all descendants of this pose node
    // Simple BFS to layout vertically downwards in this column
    const queue = [poseNode.id];
    const visited = new Set<string>();
    visited.add(poseNode.id);
    
    while (queue.length > 0) {
      const parentId = queue.shift()!;
      // Find children
      const childrenEdges = edges.filter(e => e.source === parentId);
      
      let firstChild = true;
      childrenEdges.forEach(edge => {
        const childId = edge.target;
        if (!visited.has(childId)) {
          visited.add(childId);
          queue.push(childId);
          
          const childNode = layoutedNodes.find(n => n.id === childId);
          if (childNode) {
            if (firstChild) {
              currentY += verticalSpacing;
              firstChild = false;
            } else {
              // If multiple children (unlikely in our straight vertical branch chain), space them out
              // But our attempt chain is strictly vertical
              currentY += verticalSpacing; 
            }
            childNode.position = { x: baseX, y: currentY };
          }
        }
      });
    }
  });

  return { nodes: layoutedNodes, edges };
}
