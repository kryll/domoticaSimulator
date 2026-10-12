import { Suspense, lazy, memo, useEffect, useRef, useState } from 'react';
import { Handle, NodeToolbar, Position, type NodeProps } from '@xyflow/react';
import type { DeviceNode } from './types';
import { PROTOCOL_COLORS } from './style';
import { PROTOCOL_LABELS, isCloud } from '../devices/catalog';
import { effectiveIotClass } from '../devices/roles';
import { useSimulationStore } from '../store/simulationStore';
import { cx } from '../ui/cx';
import { NodeBody } from './nodes/bodies';
import { LOW_BATTERY_LEVEL } from '../simulation/energy';

const DevicePopover = lazy(() => import('./DevicePopover').then((m) => ({ default: m.DevicePopover })));

const severityRing = {
  error: 'ring-2 ring-red-500',
  warning: 'ring-2 ring-amber-400',
  info: 'ring-1 ring-sky-300',
} as const;

/** Intervalo mínimo entre pasos de la rueda (trackpads envían muchos eventos). */
const WHEEL_INTERVAL_MS = 90;

/** Halo de la luz: color y opacidad según el brillo. */
function LightHalo({ color, pct }: { color: string; pct: number }) {
  const alpha = 0.35 + 0.65 * Math.max(0, Math.min(1, pct / 100));
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -inset-4 rounded-full transition-opacity duration-300 motion-reduce:transition-none"
      style={{ background: `radial-gradient(circle, ${color} 0%, ${color} 35%, transparent 72%)`, opacity: alpha }}
    />
  );
}

function MotionWaves() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className="ha-wave absolute inset-0 rounded-full border-2 border-orange-400" />
      <span className="ha-wave ha-wave-2 absolute inset-0 rounded-full border-2 border-orange-400" />
    </span>
  );
}

function DeviceNodeViewImpl({ id, data, selected }: NodeProps<DeviceNode>) {
  const {
    device,
    definition,
    view,
    steppable,
    icon,
    mode,
    primaryLabel,
    popoverOpen,
    activityKey,
    issueSeverity,
    issueMessages,
    unreachable,
    highlighted,
    connectMode,
    crossFloorLinks,
    watts,
    batteryPct,
  } = data;
  const lowBattery = batteryPct !== undefined && batteryPct < LOW_BATTERY_LEVEL;
  // Evita repetir en la fila inferior lo que ya muestran los indicadores de potencia y batería.
  const secondary =
    view?.secondary && ((batteryPct !== undefined && /^Batería/.test(view.secondary)) || (watts !== undefined && /^[\d,.]+ W$/.test(view.secondary)))
      ? undefined
      : view?.secondary;
  const linkFloors = [...new Set(crossFloorLinks.map((l) => l.floorName))];
  const color = PROTOCOL_COLORS[device.protocol];
  const cloud = definition ? isCloud(effectiveIotClass(device, definition)) : false;
  const interact = mode === 'interact';
  const unavailable = view?.unavailable ?? false;
  const active = !unavailable && (view?.active ?? false);
  const kind = view?.kind ?? 'generic';
  const ref = useRef<HTMLDivElement>(null);

  // Destello cuando llega una entrada nueva del registro (mandos, cambios por automatización).
  const [flash, setFlash] = useState(0);
  const firstActivity = useRef(activityKey);
  useEffect(() => {
    if (activityKey === undefined || activityKey === firstActivity.current) return;
    firstActivity.current = undefined;
    setFlash((n) => n + 1);
  }, [activityKey]);

  // Rueda: en Uso sin modificador; en Edición con Mayús. Escucha nativa (no pasiva) para poder
  // impedir el zoom del lienzo.
  const wheelAt = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Sin nivel que ajustar (sensores, mandos...) la rueda sigue haciendo zoom.
      if (!steppable || !(interact || e.shiftKey)) return;
      e.preventDefault();
      e.stopPropagation();
      const now = performance.now();
      if (now - wheelAt.current < WHEEL_INTERVAL_MS) return;
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      wheelAt.current = now;
      useSimulationStore.getState().step(id, delta < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [id, interact, steppable]);

  const lightColor = view?.colorCss ?? '#fbbf24';

  return (
    <div
      ref={ref}
      className={cx(
        'group relative flex min-h-[70px] w-[180px] items-center gap-2 rounded-lg border bg-white px-2 py-1.5 shadow-sm transition-colors motion-reduce:transition-none',
        interact && !connectMode && 'cursor-pointer',
        interact && steppable && 'nowheel',
        active ? 'border-amber-400 bg-amber-50/70' : 'border-slate-300',
        unavailable && 'border-dashed border-slate-400 bg-slate-100 grayscale',
        unreachable && !unavailable && 'border-dashed border-red-500 bg-red-50',
        issueSeverity && severityRing[issueSeverity],
        highlighted && 'outline outline-2 outline-offset-2 outline-fuchsia-500',
        selected && 'outline outline-2 outline-offset-2 outline-sky-600',
      )}
      title={issueMessages.length > 0 ? issueMessages.join('\n') : undefined}
      data-testid={`device-node-${device.id}`}
      data-kind={kind}
      data-active={active ? 'true' : 'false'}
    >
      {flash > 0 && <span key={flash} aria-hidden="true" className="ha-flash pointer-events-none absolute inset-0 rounded-lg" />}
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center" aria-hidden="true">
        {kind === 'light' && active && <LightHalo color={lightColor} pct={view?.brightnessPct ?? 100} />}
        {kind === 'motion' && active && <MotionWaves />}
        <span
          className={cx(
            'relative flex h-9 w-9 items-center justify-center rounded-full text-lg',
            active ? (kind === 'light' ? 'bg-white/70' : 'bg-amber-200') : 'bg-slate-100',
            kind === 'vacuum' && active && 'ha-spin',
          )}
        >
          {icon}
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">{device.name}</div>
          {!interact && !connectMode && primaryLabel && !unavailable && (
            <button
              type="button"
              className="nodrag nopan flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] text-slate-700 opacity-60 hover:bg-amber-100 hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 group-hover:opacity-100"
              aria-label={`${primaryLabel} ${device.name}`}
              title={`${primaryLabel} (Alt+clic)`}
              onClick={(e) => {
                e.stopPropagation();
                useSimulationStore.getState().quickAction(id);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              ⏻
            </button>
          )}
        </div>
        {unavailable ? (
          <div className="text-xs font-semibold italic text-slate-500" data-testid="node-summary">
            no disponible
          </div>
        ) : view ? (
          <NodeBody view={view} onStep={(dir) => useSimulationStore.getState().step(id, dir)} />
        ) : null}
        <div className="mt-0.5 flex min-w-0 items-center gap-1">
          <span className="shrink-0 rounded px-1 text-[9px] font-bold uppercase text-white" style={{ backgroundColor: color }}>
            {PROTOCOL_LABELS[device.protocol]}
          </span>
          {cloud && (
            <span className="shrink-0 text-[9px] font-semibold text-violet-700" title="Integración en la nube">
              ☁
            </span>
          )}
          {!unavailable && watts !== undefined && (
            <span className="shrink-0 text-[10px] font-semibold tabular-nums text-amber-700" data-testid="node-watts">
              · {watts} W
            </span>
          )}
          {batteryPct !== undefined && (
            <span
              className={cx(
                'shrink-0 rounded px-0.5 text-[10px] font-semibold tabular-nums',
                lowBattery ? 'bg-red-100 text-red-700' : 'text-slate-500',
              )}
              title={lowBattery ? `Batería baja: ${batteryPct} %` : `Batería ${batteryPct} %`}
              data-testid="node-battery"
            >
              <span aria-hidden="true">{lowBattery ? '🪫' : '🔋'}</span>
              {batteryPct} %{lowBattery && <span className="sr-only"> (batería baja)</span>}
            </span>
          )}
          {!unavailable && secondary && (
            <span className="min-w-0 truncate text-[10px] text-slate-500" title={secondary}>
              {secondary}
            </span>
          )}
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
      <NodeToolbar isVisible={popoverOpen} position={Position.Right} offset={12} className="nodrag nopan nowheel">
        {popoverOpen && (
          <Suspense fallback={<div className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-500 shadow-xl">Cargando…</div>}>
            <DevicePopover deviceId={device.id} />
          </Suspense>
        )}
      </NodeToolbar>
    </div>
  );
}

export const DeviceNodeView = memo(DeviceNodeViewImpl);
