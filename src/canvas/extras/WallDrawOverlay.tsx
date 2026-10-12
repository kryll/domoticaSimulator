import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { Floor, Point, Wall, WallMaterial } from '../../types';
import { setFloorWalls } from './wallActions';
import { useExtrasStore } from '../../store/extrasStore';
import { Button } from '../../ui/Button';
import { WALL_MATERIAL_LABELS, constrainOrthogonal, makeWall, snapPoint, wallLengthMeters } from './wallGeometry';
import { confirmDialog } from '../../ui/confirm';

const EMPTY: Wall[] = [];

/**
 * Modo «Dibujar pared»: arrastra para trazar un tramo (Mayús = horizontal/vertical). Los extremos
 * se ajustan a la rejilla y a las paredes existentes.
 */
export function WallDrawOverlay({ floor }: { floor: Floor }) {
  const { screenToFlowPosition, flowToScreenPosition } = useReactFlow();
  const ref = useRef<HTMLDivElement>(null);
  const material = useExtrasStore((s) => s.wallMaterial);
  const setMaterial = useExtrasStore((s) => s.setWallMaterial);
  const walls = floor.walls ?? EMPTY;
  const [start, setStart] = useState<Point | null>(null);
  const [end, setEnd] = useState<Point | null>(null);

  useEffect(() => {
    if (!start) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setStart(null);
        setEnd(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [start]);

  const toFlow = (e: PointerEvent<HTMLDivElement>) => snapPoint(screenToFlowPosition({ x: e.clientX, y: e.clientY }), walls);

  const local = (p: Point): Point => {
    const s = flowToScreenPosition(p);
    const r = ref.current?.getBoundingClientRect();
    return { x: s.x - (r?.left ?? 0), y: s.y - (r?.top ?? 0) };
  };

  const finish = (e: PointerEvent<HTMLDivElement>) => {
    if (!start) return;
    let b = toFlow(e);
    if (e.shiftKey) b = constrainOrthogonal(start, b);
    setStart(null);
    setEnd(null);
    const wall = makeWall(start, b, material);
    if (wall) setFloorWalls(floor.id, [...walls, wall]);
  };

  const a = start ? local(start) : null;
  const b = end ? local(end) : null;

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-10 cursor-crosshair"
      aria-label="Zona de dibujo de paredes"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const p = toFlow(e);
        setStart(p);
        setEnd(p);
      }}
      onPointerMove={(e) => {
        if (!start) return;
        const p = toFlow(e);
        setEnd(e.shiftKey ? constrainOrthogonal(start, p) : p);
      }}
      onPointerUp={finish}
    >
      {a && b && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0369a1" strokeWidth={4} strokeDasharray="6 4" strokeLinecap="round" />
        </svg>
      )}
      {start && end && (
        <div className="pointer-events-none absolute rounded bg-slate-800/90 px-1.5 py-0.5 text-[11px] text-white" style={{ left: (b?.x ?? 0) + 12, top: (b?.y ?? 0) + 12 }}>
          {wallLengthMeters({ a: start, b: end }, floor.pixelsPerMeter).toFixed(1)} m
        </div>
      )}
      <div
        className="absolute left-1/2 top-2 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded bg-sky-700 px-2 py-1 text-xs text-white shadow"
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
      >
        <span>Arrastra para dibujar una pared · Mayús = recta · Esc para salir</span>
        <label className="flex items-center gap-1">
          Material
          <select
            value={material}
            onChange={(e) => setMaterial(e.target.value as WallMaterial)}
            className="rounded border border-sky-300 bg-white px-1 py-0.5 text-xs text-slate-800"
          >
            {(Object.keys(WALL_MATERIAL_LABELS) as WallMaterial[]).map((m) => (
              <option key={m} value={m}>
                {WALL_MATERIAL_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" disabled={walls.length === 0} onClick={() => setFloorWalls(floor.id, walls.slice(0, -1))}>
          Quitar última
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={walls.length === 0}
          onClick={async () => {
            const ok = await confirmDialog({
              title: `¿Borrar las ${walls.length} paredes de «${floor.name}»?`,
              message: 'Puedes recuperarlas con Deshacer.',
              confirmLabel: 'Borrar paredes',
              danger: true,
            });
            if (ok) setFloorWalls(floor.id, []);
          }}
        >
          Borrar todas
        </Button>
      </div>
    </div>
  );
}
