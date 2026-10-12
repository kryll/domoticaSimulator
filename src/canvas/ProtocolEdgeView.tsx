import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react';
import type { ProtocolEdge } from './types';
import { PROTOCOL_COLORS } from './style';
import { PROTOCOL_LABELS } from '../devices/catalog';

function center(node: InternalNode): { x: number; y: number } {
  const w = node.measured.width ?? 0;
  const h = node.measured.height ?? 0;
  return { x: node.internals.positionAbsolute.x + w / 2, y: node.internals.positionAbsolute.y + h / 2 };
}

/** Arista "flotante": línea recta entre los centros de los dispositivos, coloreada por protocolo. */
function ProtocolEdgeViewImpl({ id, source, target, data, selected, sourceX, sourceY, targetX, targetY }: EdgeProps<ProtocolEdge>) {
  const s = useInternalNode(source);
  const t = useInternalNode(target);
  const a = s ? center(s) : { x: sourceX, y: sourceY };
  const b = t ? center(t) : { x: targetX, y: targetY };
  const protocol = data?.protocol ?? 'wifi';
  const color = PROTOCOL_COLORS[protocol];
  const path = `M ${a.x},${a.y} L ${b.x},${b.y}`;
  const dashed = protocol === 'wifi' || protocol === 'ble' || protocol === 'rf433';

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={14}
        style={{
          stroke: color,
          strokeWidth: selected ? 4 : 2,
          strokeDasharray: dashed ? '6 4' : undefined,
          opacity: selected ? 1 : 0.85,
        }}
      />
      {selected && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute rounded bg-white px-1 text-[10px] font-semibold shadow"
            style={{ transform: `translate(-50%, -50%) translate(${(a.x + b.x) / 2}px, ${(a.y + b.y) / 2}px)`, color }}
          >
            {PROTOCOL_LABELS[protocol]}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ProtocolEdgeView = memo(ProtocolEdgeViewImpl);
