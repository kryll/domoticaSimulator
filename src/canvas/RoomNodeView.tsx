import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { RoomLabelNode, RoomNode } from './types';
import { cx } from '../ui/cx';

function RoomNodeViewImpl({ data, selected, width, height }: NodeProps<RoomNode>) {
  return (
    <div
      className={cx('h-full w-full rounded-sm border-2 bg-sky-400/5', selected ? 'border-sky-600' : 'border-slate-400/70')}
      style={{ width, height }}
      data-testid={`room-node-${data.room.id}`}
    />
  );
}

export const RoomNodeView = memo(RoomNodeViewImpl);

/**
 * Etiqueta de la sala como nodo propio: queda por encima de las conexiones y por debajo de los
 * dispositivos, en un hueco libre del borde de la sala (C8).
 */
function RoomLabelNodeViewImpl({ data }: NodeProps<RoomLabelNode>) {
  return (
    <span
      className="pointer-events-none block whitespace-nowrap rounded-full bg-white/90 px-2.5 py-0.5 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-slate-300/80"
      data-testid="room-label"
    >
      {data.name}
      {data.deviceCount > 0 && <span className="ml-1 font-normal text-slate-600">({data.deviceCount})</span>}
    </span>
  );
}

export const RoomLabelNodeView = memo(RoomLabelNodeViewImpl);
