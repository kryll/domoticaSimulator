import { memo } from 'react';
import type { DeviceDefinition } from '../types';
import { PROTOCOL_INK } from '../canvas/style';
import { deviceIcon } from '../devices/presentation';
import { DEVICE_DRAG_MIME } from '../canvas/types';
import { PROTOCOL_LABELS, isCloud } from '../devices/catalog';
import { Badge } from '../ui/Badge';

export interface CatalogCardProps {
  definition: DeviceDefinition;
  onAdd: (definition: DeviceDefinition) => void;
}

function CatalogCardImpl({ definition, onAdd }: CatalogCardProps) {
  const cloud = isCloud(definition.iotClass);
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DEVICE_DRAG_MIME, definition.id);
        e.dataTransfer.setData('text/plain', definition.name);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      className="group flex cursor-grab items-start gap-2 rounded-md border border-slate-200 bg-white p-2 hover:border-sky-300 hover:shadow-sm active:cursor-grabbing"
      aria-label={`${definition.brand} ${definition.name}`}
    >
      <span className="mt-0.5 text-xl" aria-hidden="true">
        {deviceIcon(definition)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-800" title={definition.name}>
          {definition.name}
        </div>
        <div className="truncate text-xs text-slate-500">
          {definition.brand} · {definition.model}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {definition.protocols.map((p) => (
            <Badge key={p} color={PROTOCOL_INK[p]}>
              {PROTOCOL_LABELS[p]}
            </Badge>
          ))}
          <Badge tone={cloud ? 'violet' : 'green'} title={cloud ? 'Depende de la nube' : 'Control local'}>
            {cloud ? 'Nube' : 'Local'}
          </Badge>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onAdd(definition)}
        className="rounded px-1.5 text-lg leading-none text-slate-600 hover:bg-sky-50 hover:text-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        aria-label={`Añadir ${definition.name} al lienzo`}
        title="Añadir al lienzo"
      >
        +
      </button>
    </li>
  );
}

export const CatalogCard = memo(CatalogCardImpl);
