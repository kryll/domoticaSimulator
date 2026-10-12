import { ViewportPortal } from '@xyflow/react';
import type { Device, Floor } from '../types';
import { coverageRadiusPx } from '../network/coverage';
import { PROTOCOL_COLORS } from './style';
import { definitionOf } from './analysis';

/** Círculos de cobertura de radio de los dispositivos de la planta. */
export function CoverageLayer({ devices, floor }: { devices: Device[]; floor: Floor }) {
  return (
    <ViewportPortal>
      <div className="pointer-events-none" aria-hidden="true">
        {devices.map((d) => {
          const def = definitionOf(d);
          if (!def) return null;
          const r = coverageRadiusPx(def, floor);
          if (!r || r <= 0) return null;
          const color = PROTOCOL_COLORS[d.protocol];
          return (
            <div
              key={d.id}
              className="absolute rounded-full border"
              style={{
                left: d.position.x - r,
                top: d.position.y - r,
                width: r * 2,
                height: r * 2,
                backgroundColor: `${color}12`,
                borderColor: `${color}55`,
              }}
            />
          );
        })}
      </div>
    </ViewportPortal>
  );
}
