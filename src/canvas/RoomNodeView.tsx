import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RoomNode } from './types';
import { cx } from '../ui/cx';

function RoomNodeViewImpl({ data, selected, width, height }: NodeProps<RoomNode>) {
  return (
    <div
      className={cx(
        'h-full w-full rounded-sm border-2 bg-sky-400/5',
        selected ? 'border-sky-600' : 'border-slate-400/70',
      )}
      style={{ width, height }}
      data-testid={`room-node-${data.room.id}`}
    >
      <span className="absolute left-1 top-1 rounded bg-white/80 px-1 text-xs font-semibold text-slate-600">
        {data.room.name}
        {data.deviceCount > 0 && <span className="ml-1 font-normal text-slate-400">({data.deviceCount})</span>}
      </span>
    </div>
  );
}

export const RoomNodeView = memo(RoomNodeViewImpl);
