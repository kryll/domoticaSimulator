import { memo } from 'react';
import { ViewportPortal } from '@xyflow/react';
import type { Wall } from '../../types';
import { WALL_MATERIAL_LABELS, WALL_MATERIAL_STYLE } from './wallGeometry';

function bounds(walls: Wall[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const w of walls) {
    for (const p of [w.a, w.b]) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const pad = 10;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/** Paredes de la planta dibujadas sobre el plano (por debajo de los dispositivos). */
function WallsLayerImpl({ walls }: { walls: Wall[] }) {
  if (walls.length === 0) return null;
  const b = bounds(walls);
  return (
    <ViewportPortal>
      <svg
        className="pointer-events-none absolute overflow-visible"
        style={{ left: b.x, top: b.y, width: b.w, height: b.h, zIndex: -1 }}
        viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
        aria-hidden="true"
        data-testid="walls-layer"
      >
        {walls.map((w, i) => {
          const st = WALL_MATERIAL_STYLE[w.material];
          return (
            <line
              key={i}
              x1={w.a.x}
              y1={w.a.y}
              x2={w.b.x}
              y2={w.b.y}
              stroke={st.color}
              strokeWidth={st.width}
              strokeDasharray={st.dash}
              strokeLinecap="round"
            >
              <title>{WALL_MATERIAL_LABELS[w.material]}</title>
            </line>
          );
        })}
      </svg>
    </ViewportPortal>
  );
}

export const WallsLayer = memo(WallsLayerImpl);
