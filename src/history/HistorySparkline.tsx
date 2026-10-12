import { useMemo, useState } from 'react';
import type { HistorySample } from '../types';
import { useSimulationStore } from '../store/simulationStore';
import { historySeries, isNumericSeries } from '../simulation/history';
import { formatSimTime } from '../simulation/clock';
import { activeSegments, numericPath } from './sparkline';

const WINDOWS = [
  { label: '1 h', ms: 3_600_000 },
  { label: '6 h', ms: 6 * 3_600_000 },
  { label: '24 h', ms: 24 * 3_600_000 },
];
const EMPTY: HistorySample[] = [];
const W = 240;
const H = 44;

function fmt(n: number): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 1 });
}

/**
 * Minigráfica del historial de una entidad numérica (línea escalonada) o binaria (franjas).
 * Se actualiza como mucho una vez por minuto simulado.
 */
export function HistorySparkline({ entityId, unit, binary }: { entityId: string; unit?: string; binary?: boolean }) {
  const [win, setWin] = useState(0);
  const samples = useSimulationStore((s) => s.sim.history?.[entityId] ?? EMPTY);
  const minute = useSimulationStore((s) => Math.floor(s.sim.now / 60_000));
  const span = WINDOWS[win]?.ms ?? 3_600_000;
  const to = (minute + 1) * 60_000;
  const from = to - span;
  // `samples` en las dependencias: se recalcula solo cuando cambia el historial de la entidad.
  const series = useMemo(
    () => (samples.length === 0 ? EMPTY : historySeries(useSimulationStore.getState().sim, entityId, from, to)),
    [samples, entityId, from, to],
  );
  if (samples.length === 0) return null;
  const numeric = !binary && isNumericSeries(series);
  const path = numeric ? numericPath(series, from, to, { width: W, height: H, pad: 3 }) : null;
  const segs = numeric ? [] : activeSegments(series, from, to, W);
  const last = series[series.length - 1];
  const label = numeric && path
    ? `Historial de ${span / 3_600_000} h: mínimo ${fmt(path.min)}${unit ? ` ${unit}` : ''}, máximo ${fmt(path.max)}${unit ? ` ${unit}` : ''}`
    : `Historial de ${span / 3_600_000} h: ${segs.length} periodos activos`;

  return (
    <figure className="mt-1" aria-label={`Historial de ${entityId}`}>
      <div className="mb-0.5 flex items-center justify-between">
        <figcaption className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Historial</figcaption>
        <div className="flex gap-0.5" role="group" aria-label="Ventana del historial">
          {WINDOWS.map((w, i) => (
            <button
              key={w.label}
              type="button"
              aria-pressed={i === win}
              onClick={() => setWin(i)}
              className={
                i === win
                  ? 'rounded bg-sky-600 px-1 text-[10px] font-semibold text-white'
                  : 'rounded px-1 text-[10px] text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500'
              }
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-11 w-full rounded bg-slate-50" role="img" aria-label={label} preserveAspectRatio="none">
        {numeric && path ? (
          <path d={path.d} fill="none" stroke="#0284c7" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ) : (
          segs.map((s, i) => <rect key={i} x={s.x} y={6} width={s.w} height={H - 12} fill="#f59e0b" opacity={0.8} />)
        )}
      </svg>
      <div className="flex justify-between text-[10px] tabular-nums text-slate-400">
        <span>{formatSimTime(from)}</span>
        {numeric && path && (
          <span className="text-slate-500">
            {fmt(path.min)}–{fmt(path.max)}
            {unit ? ` ${unit}` : ''}
          </span>
        )}
        <span>{last ? formatSimTime(to) : ''}</span>
      </div>
    </figure>
  );
}
