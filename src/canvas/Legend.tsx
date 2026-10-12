import { PROTOCOL_LABELS } from '../devices/catalog';
import type { Protocol } from '../types';
import { PROTOCOL_COLORS } from './style';

/** Leyenda de colores por protocolo. */
export function Legend({ protocols }: { protocols?: Protocol[] }) {
  const list = protocols ?? (Object.keys(PROTOCOL_COLORS) as Protocol[]);
  return (
    <div className="rounded-md border border-slate-200 bg-white/90 p-2 text-[11px] shadow-sm" aria-label="Leyenda de protocolos">
      <div className="mb-1 font-semibold text-slate-600">Protocolos</div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {list.map((p) => (
          <li key={p} className="flex items-center gap-1.5 text-slate-700">
            <span className="inline-block h-0.5 w-4" style={{ backgroundColor: PROTOCOL_COLORS[p] }} aria-hidden="true" />
            {PROTOCOL_LABELS[p]}
          </li>
        ))}
      </ul>
    </div>
  );
}
