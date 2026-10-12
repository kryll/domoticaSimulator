// Subvistas del nodo de dispositivo según el tipo de presentación (DeviceView.kind).
import type { ReactNode } from 'react';
import type { DeviceView } from '../../devices/presentation';
import { cx } from '../../ui/cx';
import { clock } from './format';

export interface BodyProps {
  view: DeviceView;
  /** Ajuste rápido (termostato −/+). */
  onStep?: (direction: 1 | -1) => void;
}

/** Línea principal: el resumen (el secundario va en la fila inferior del nodo). */
function Summary({ view, big = false, extra }: { view: DeviceView; big?: boolean; extra?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span
        className={cx('truncate font-semibold tabular-nums text-slate-900', big ? 'text-[15px] leading-5' : 'text-xs')}
        data-testid="node-summary"
      >
        {view.summary}
      </span>
      {extra}
    </div>
  );
}

/** Barra de nivel (persiana, volumen, brillo). */
export function LevelBar({ pct, color = 'bg-sky-500', label }: { pct: number; color?: string; label: string }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
    >
      <div className={cx('h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none', color)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function LightBody({ view }: BodyProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <Summary view={view} />
      {view.active && view.brightnessPct !== undefined && (
        <LevelBar pct={view.brightnessPct} color="bg-amber-400" label="Brillo" />
      )}
    </div>
  );
}

export function CoverBody({ view }: BodyProps) {
  const pct = view.positionPct ?? 0;
  const dir = view.moving;
  return (
    <div className="flex flex-col gap-0.5">
      <Summary
        view={view}
        extra={
          dir ? (
            <span
              className={cx('text-sm font-bold text-sky-700', dir === 'down' ? 'ha-nudge-down' : 'ha-nudge-up')}
              aria-label={dir === 'down' ? 'Bajando' : 'Subiendo'}
            >
              {dir === 'down' ? '▼' : '▲'}
            </span>
          ) : null
        }
      />
      <LevelBar pct={pct} color={dir ? 'bg-sky-400' : 'bg-sky-600'} label="Posición de la persiana" />
    </div>
  );
}

export function MotionBody({ view }: BodyProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Summary view={view} />
      {view.active && view.countdownSeconds !== undefined && (
        <span className="rounded bg-orange-100 px-1 text-[10px] font-semibold tabular-nums text-orange-800" title="Tiempo hasta volver a «sin movimiento»">
          ⏱ {clock(view.countdownSeconds)}
        </span>
      )}
    </div>
  );
}

/** Puerta dibujada: hoja cerrada o entreabierta. */
function DoorGlyph({ open }: { open: boolean }) {
  return (
    <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden="true" className="shrink-0">
      <rect x="1" y="1" width="12" height="18" rx="1" fill="none" stroke="#64748b" strokeWidth="1.5" />
      {open ? (
        <path d="M1 1 L8 4 L8 21 L1 19 Z" fill="#fdba74" stroke="#c2410c" strokeWidth="1" />
      ) : (
        <>
          <rect x="2.5" y="2.5" width="9" height="15" fill="#86efac" stroke="#15803d" strokeWidth="1" />
          <circle cx="9.5" cy="10" r="0.9" fill="#15803d" />
        </>
      )}
    </svg>
  );
}

export function DoorBody({ view }: BodyProps) {
  return (
    <div className="flex items-center gap-1.5">
      {view.kind === 'contact' && <DoorGlyph open={view.active} />}
      <span
        className={cx(
          'rounded px-1.5 py-0.5 text-xs font-semibold',
          view.active ? 'bg-orange-100 text-orange-800' : 'bg-emerald-50 text-emerald-800',
        )}
        data-testid="node-summary"
      >
        {view.summary}
      </span>
    </div>
  );
}

/** Sensores de clima: lecturas grandes. */
export function ReadingBody({ view }: BodyProps) {
  return <Summary view={view} big />;
}

export function ThermostatBody({ view, onStep }: BodyProps) {
  return (
    <div className="flex items-center gap-1">
      <Summary
        view={view}
        big
        extra={
          view.heating ? (
            <span className="ha-flicker text-sm" role="img" aria-label="Calentando" title="Calentando">
              🔥
            </span>
          ) : null
        }
      />
      {onStep && (
        <span className="nodrag nopan absolute right-1.5 top-6 flex gap-0.5 rounded bg-white/90 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
          <NodeMiniButton label="Bajar consigna" onClick={() => onStep(-1)}>
            −
          </NodeMiniButton>
          <NodeMiniButton label="Subir consigna" onClick={() => onStep(1)}>
            +
          </NodeMiniButton>
        </span>
      )}
    </div>
  );
}

export function LockBody({ view }: BodyProps) {
  const s = view.summary.toLowerCase();
  const jammed = s.includes('atasc');
  const open = !jammed && view.active;
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cx(
          'rounded px-1.5 py-0.5 text-xs font-semibold',
          jammed ? 'bg-amber-200 text-amber-900' : open ? 'bg-red-100 text-red-800' : 'bg-emerald-100 text-emerald-800',
        )}
        data-testid="node-summary"
      >
        {jammed ? '⚠ ' : open ? '🔓 ' : '🔒 '}
        {view.summary}
      </span>
    </div>
  );
}

export function MediaBody({ view }: BodyProps) {
  const playing = view.active;
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        {playing && (
          <span className="ha-eq flex h-3 items-end gap-[2px]" aria-hidden="true">
            <span className="h-full w-[3px] rounded-sm bg-violet-500" />
            <span className="h-full w-[3px] rounded-sm bg-violet-500" />
            <span className="h-full w-[3px] rounded-sm bg-violet-500" />
            <span className="h-full w-[3px] rounded-sm bg-violet-500" />
          </span>
        )}
        <Summary view={view} />
      </div>
      {view.volumePct !== undefined && (
        <LevelBar pct={view.volumePct} color="bg-violet-400" label="Volumen" />
      )}
    </div>
  );
}

export function GenericBody({ view }: BodyProps) {
  return <Summary view={view} />;
}

/** Botón pequeño dentro de un nodo: no arrastra ni desplaza el lienzo. */
export function NodeMiniButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className="nodrag nopan flex h-5 w-5 items-center justify-center rounded border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      {children}
    </button>
  );
}

/** Subvista por tipo. Los tipos desconocidos usan la genérica. */
export function NodeBody(props: BodyProps) {
  switch (props.view.kind) {
    case 'light':
      return <LightBody {...props} />;
    case 'cover':
      return <CoverBody {...props} />;
    case 'motion':
      return <MotionBody {...props} />;
    case 'contact':
    case 'leak':
    case 'smoke':
      return <DoorBody {...props} />;
    case 'climate_sensor':
      return <ReadingBody {...props} />;
    case 'thermostat':
      return <ThermostatBody {...props} />;
    case 'lock':
      return <LockBody {...props} />;
    case 'media':
      return <MediaBody {...props} />;
    default:
      return <GenericBody {...props} />;
  }
}
