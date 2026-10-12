import { useId, useMemo, useState } from 'react';
import type { HistorySample } from '../types';
import { useSimulationStore } from '../store/simulationStore';
import { attributeKey, historyAttributes, historySeries } from '../simulation/history';
import { attributeMeta, displaySamples } from './attributeLabels';
import { formatSimTime } from '../simulation/clock';
import { activeSegments, gapSegments, isNumericWithGaps, numericPath } from './sparkline';

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

/** Serie elegida: el estado de la entidad o uno de sus atributos. */
const STATE = '__estado__';

export type StateMode = 'binary' | 'numeric' | 'none';

/**
 * Minigráfica del historial de una entidad: su estado (línea escalonada si es numérico, franjas si
 * es binario) o uno de sus atributos con historial (brillo, posición, temperatura actual...).
 * Se actualiza como mucho una vez por minuto simulado.
 */
export function HistorySparkline({ entityId, unit: stateUnit, stateMode = 'numeric', binary }: { entityId: string; unit?: string; stateMode?: StateMode; binary?: boolean }) {
  const mode: StateMode = binary ? 'binary' : stateMode;
  const [win, setWin] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const gapId = `gap-${useId().replace(/:/g, '')}`;
  const selectId = useId();
  // Atributos con historial (como texto para no volver a pintar si no cambia la lista).
  const attrsKey = useSimulationStore((s) => historyAttributes(s.sim, entityId).join('|'));
  const attributes = useMemo(() => (attrsKey === '' ? [] : attrsKey.split('|')), [attrsKey]);
  const options = [...(mode === 'none' ? [] : [STATE]), ...attributes];
  const series_ = picked !== null && options.includes(picked) ? picked : (options[0] ?? STATE);
  const attribute = series_ === STATE ? undefined : series_;
  const meta = attribute === undefined ? { label: 'Estado', unit: stateUnit } : attributeMeta(attribute);
  const unit = meta.unit;
  const historyKey = attribute === undefined ? entityId : attributeKey(entityId, attribute);
  const samples = useSimulationStore((s) => s.sim.history?.[historyKey] ?? EMPTY);
  const minute = useSimulationStore((s) => Math.floor(s.sim.now / 60_000));
  const span = WINDOWS[win]?.ms ?? 3_600_000;
  const to = (minute + 1) * 60_000;
  const from = to - span;
  // `samples` en las dependencias: se recalcula solo cuando cambia esa serie.
  const series = useMemo(
    () =>
      samples.length === 0
        ? EMPTY
        : displaySamples(
            historySeries(useSimulationStore.getState().sim, entityId, from, to, attribute),
            attribute === undefined ? { label: 'Estado' } : attributeMeta(attribute),
          ),
    [samples, entityId, from, to, attribute],
  );
  if (samples.length === 0 && attributes.length === 0) return null;
  const binary_ = attribute === undefined ? mode === 'binary' : meta.activeValues !== undefined;
  const numeric = !binary_ && isNumericWithGaps(series);
  const gaps = gapSegments(series, from, to, W);
  const path = numeric ? numericPath(series, from, to, { width: W, height: H, pad: 3 }) : null;
  const segs = numeric ? [] : activeSegments(series, from, to, W);
  const last = series[series.length - 1];
  const label = numeric && path
    ? `Historial de ${span / 3_600_000} h: mínimo ${fmt(path.min)}${unit ? ` ${unit}` : ''}, máximo ${fmt(path.max)}${unit ? ` ${unit}` : ''}`
    : `Historial de ${span / 3_600_000} h: ${segs.length} periodos activos`;
  const fullLabel = gaps.length > 0 ? `${label}, ${gaps.length} ${gaps.length === 1 ? 'tramo' : 'tramos'} sin datos` : label;

  return (
    <figure className="mt-1" aria-label={`Historial de ${entityId}${attribute !== undefined ? ` (${meta.label})` : ''}`}>
      <div className="mb-0.5 flex items-center justify-between">
        <figcaption className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
          {options.length > 1 ? (
            <>
              <label htmlFor={selectId} className="sr-only">
                Serie del historial
              </label>
              <select
                id={selectId}
                value={series_}
                onChange={(e) => setPicked(e.target.value)}
                className="rounded border border-slate-200 bg-white px-1 py-0 text-[10px] font-medium normal-case text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                {options.map((o) => {
                  const m = o === STATE ? { label: 'Estado', unit: stateUnit } : attributeMeta(o);
                  return (
                    <option key={o} value={o}>
                      {m.label}
                      {m.unit ? ` (${m.unit})` : ''}
                    </option>
                  );
                })}
              </select>
            </>
          ) : (
            <>Historial{attribute !== undefined ? ` · ${meta.label}` : ''}</>
          )}
        </figcaption>
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
      <svg viewBox={`0 0 ${W} ${H}`} className="h-11 w-full rounded bg-slate-50" role="img" aria-label={fullLabel} preserveAspectRatio="none">
        <defs>
          <pattern id={gapId} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2" height="4" fill="#cbd5e1" />
          </pattern>
        </defs>
        {gaps.map((g, i) => (
          <rect key={`gap-${i}`} x={g.x} y={0} width={g.w} height={H} fill={`url(#${gapId})`} data-testid="sparkline-gap">
            <title>No disponible</title>
          </rect>
        ))}
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
