import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { PlanNode } from './types';

function PlanNodeViewImpl({ data }: NodeProps<PlanNode>) {
  return <img src={data.src} alt="Plano de la planta" className="max-w-none select-none opacity-60" draggable={false} />;
}

export const PlanNodeView = memo(PlanNodeViewImpl);
