import { ViewportPortal } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import type { Room } from '../../types';
import { useSimulationStore } from '../../store/simulationStore';
import { polygonBounds } from '../geometry';
import { formatTemperature, temperatureColor } from './climateColor';

/**
 * Capa «Clima»: tiñe cada sala según su temperatura simulada y muestra la cifra. Solo se repinta
 * cuando cambia alguna temperatura redondeada a décimas (no en cada tick).
 */
export function ClimateLayer({ rooms }: { rooms: Room[] }) {
  const temps = useSimulationStore(
    useShallow((s) => {
      const env = s.sim.environment?.rooms;
      const out: Record<string, number> = {};
      if (!env) return out;
      for (const r of rooms) {
        const t = env[r.id]?.temperature;
        if (typeof t === 'number' && Number.isFinite(t)) out[r.id] = Math.round(t * 10) / 10;
      }
      return out;
    }),
  );

  return (
    <ViewportPortal>
      <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" style={{ zIndex: -1 }} width={1} height={1} aria-hidden="true" data-testid="climate-layer">
        {rooms.map((room) => {
          const t = temps[room.id];
          if (t === undefined) return null;
          const b = polygonBounds(room.polygon);
          return (
            <g key={room.id}>
              <polygon points={room.polygon.map((p) => `${p.x},${p.y}`).join(' ')} fill={temperatureColor(t, 0.22)} stroke={temperatureColor(t, 0.6)} strokeWidth={2} />
              <text
                x={b.x + b.width / 2}
                y={b.y + b.height / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.max(14, Math.min(28, b.width / 8))}
                fontWeight={700}
                fill={temperatureColor(t, 0.95)}
                stroke="white"
                strokeWidth={3}
                paintOrder="stroke"
              >
                {formatTemperature(t)}
              </text>
            </g>
          );
        })}
      </svg>
    </ViewportPortal>
  );
}

/** Leyenda de la capa «Clima» con la temperatura exterior. */
export function ClimateLegend() {
  const outdoor = useSimulationStore((s) => {
    const t = s.sim.environment?.outdoorTemperature;
    return typeof t === 'number' ? Math.round(t * 10) / 10 : undefined;
  });
  const enabled = useSimulationStore((s) => s.sim.environment !== undefined);
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white/95 px-2 py-1 text-xs shadow-sm" role="status" data-export-ignore="">
      {enabled ? (
        <>
          <span className="font-semibold text-slate-700">Clima</span>
          <span
            className="h-2 w-24 rounded-full"
            style={{ background: `linear-gradient(to right, ${[12, 18, 21, 24, 27, 30].map((t) => temperatureColor(t)).join(', ')})` }}
            aria-hidden="true"
          />
          <span className="text-slate-500">12–30 °C</span>
          {outdoor !== undefined && <span className="text-slate-700">Exterior: <strong>{formatTemperature(outdoor)}</strong></span>}
        </>
      ) : (
        <span className="text-slate-600">Sin datos de clima: activa el modelo térmico en los ajustes de simulación (⚙).</span>
      )}
    </div>
  );
}
