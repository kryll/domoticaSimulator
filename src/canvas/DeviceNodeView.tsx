import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DeviceNode } from './types';
import { CATEGORY_ICONS, PROTOCOL_COLORS } from './style';
import { PROTOCOL_LABELS, isCloud } from '../devices/catalog';
import { effectiveIotClass } from '../devices/roles';
import { cx } from '../ui/cx';

const severityRing = {
  error: 'ring-2 ring-red-500',
  warning: 'ring-2 ring-amber-400',
  info: 'ring-1 ring-sky-300',
} as const;

function DeviceNodeViewImpl({ data, selected }: NodeProps<DeviceNode>) {
  const { device, definition, active, stateLabel, issueSeverity, issueMessages, unreachable, highlighted, connectMode, crossFloorLinks } = data;
  const linkFloors = [...new Set(crossFloorLinks.map((l) => l.floorName))];
  const color = PROTOCOL_COLORS[device.protocol];
  const icon = definition ? CATEGORY_ICONS[definition.category] : '❔';
  const cloud = definition ? isCloud(effectiveIotClass(device, definition)) : false;

  return (
    <div
      className={cx(
        'relative flex w-40 items-center gap-2 rounded-lg border bg-white px-2 py-1.5 shadow-sm',
        active ? 'border-amber-400 bg-amber-50' : 'border-slate-300',
        unreachable && 'border-dashed border-red-500 bg-red-50',
        issueSeverity && severityRing[issueSeverity],
        highlighted && 'outline outline-2 outline-offset-2 outline-fuchsia-500',
        selected && 'outline outline-2 outline-offset-2 outline-sky-600',
      )}
      title={issueMessages.length > 0 ? issueMessages.join('\n') : undefined}
      data-testid={`device-node-${device.id}`}
    >
      <span
        className={cx(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg',
          active ? 'bg-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.9)]' : 'bg-slate-100',
        )}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold text-slate-800">{device.name}</div>
        <div className="flex items-center gap-1">
          <span
            className="rounded px-1 text-[9px] font-bold uppercase text-white"
            style={{ backgroundColor: color }}
          >
            {PROTOCOL_LABELS[device.protocol]}
          </span>
          {cloud && (
            <span className="text-[9px] font-semibold text-violet-700" title="Integración en la nube">
              ☁
            </span>
          )}
          {stateLabel && <span className="truncate text-[10px] text-slate-500">{stateLabel}</span>}
        </div>
      </div>
      {(issueSeverity === 'error' || issueSeverity === 'warning' || unreachable) && (
        <span
          className={cx(
            'absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white',
            issueSeverity === 'error' || unreachable ? 'bg-red-600' : 'bg-amber-500',
          )}
          aria-label={unreachable ? 'Inalcanzable' : 'Tiene incidencias'}
        >
          !
        </span>
      )}
      {linkFloors.length > 0 && (
        <span
          className="absolute -bottom-2.5 left-2 rounded-full border border-indigo-200 bg-indigo-50 px-1.5 text-[9px] font-semibold text-indigo-700"
          title={crossFloorLinks.map((l) => `${l.deviceName} (${l.floorName})`).join('\n')}
        >
          ↕ enlace a {linkFloors.join(', ')}
        </span>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        id="c"
        className={cx(connectMode ? '!opacity-0' : '!h-2 !w-2 !border-white !bg-slate-400')}
        style={
          connectMode
            ? { top: 0, left: 0, width: '100%', height: '100%', transform: 'none', borderRadius: 8, cursor: 'crosshair' }
            : undefined
        }
      />
    </div>
  );
}

export const DeviceNodeView = memo(DeviceNodeViewImpl);
