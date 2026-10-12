import { ViewportPortal } from '@xyflow/react';
import type { RouterSuggestion } from '../../store/extrasStore';

/** Marcas de las posiciones propuestas por «Sugerir router». */
export function RouterSuggestionsLayer({ points }: { points: RouterSuggestion['points'] }) {
  return (
    <ViewportPortal>
      <div className="pointer-events-none" data-testid="router-suggestions">
        {points.map((p, i) => (
          <div
            key={`${p.position.x},${p.position.y}`}
            className="absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-dashed border-emerald-600 bg-emerald-400/30 text-lg shadow"
            style={{ left: p.position.x, top: p.position.y, zIndex: 2 }}
            title={p.reason}
          >
            <span aria-hidden="true">📶</span>
            <span className="absolute -right-1 -top-1 rounded-full bg-emerald-700 px-1 text-[10px] font-bold text-white">{i + 1}</span>
            <span className="sr-only">
              Router sugerido {i + 1}: {p.reason}
            </span>
          </div>
        ))}
      </div>
    </ViewportPortal>
  );
}
