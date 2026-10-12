import { useRef, useState, type PointerEvent } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { Id, Point } from '../types';
import { rectFromPoints, rectToPolygon } from './geometry';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';

/** Capa que permite dibujar una sala rectangular arrastrando sobre el lienzo. */
export function RoomDrawOverlay({ floorId }: { floorId: Id }) {
  const { screenToFlowPosition } = useReactFlow();
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<Point | null>(null);
  const [current, setCurrent] = useState<Point | null>(null);

  const local = (e: PointerEvent<HTMLDivElement>): Point => {
    const r = ref.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  const finish = (e: PointerEvent<HTMLDivElement>) => {
    if (!start) return;
    const r = ref.current?.getBoundingClientRect();
    const ox = r?.left ?? 0;
    const oy = r?.top ?? 0;
    const end = local(e);
    setStart(null);
    setCurrent(null);
    const a = screenToFlowPosition({ x: start.x + ox, y: start.y + oy });
    const b = screenToFlowPosition({ x: end.x + ox, y: end.y + oy });
    const rect = rectFromPoints(a, b);
    if (rect.width < 20 || rect.height < 20) return;
    const { project, addRoom } = useProjectStore.getState();
    const count = project.rooms.filter((room) => room.floorId === floorId).length;
    const room = addRoom({ floorId, name: `Sala ${count + 1}`, polygon: rectToPolygon(rect) });
    const ui = useUiStore.getState();
    ui.select({ kind: 'room', id: room.id });
    ui.setCanvasMode('select');
    ui.notify('Sala creada. Cambia su nombre en el panel de propiedades.', 'success');
  };

  const preview = start && current ? rectFromPoints(start, current) : null;

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-10 cursor-crosshair"
      aria-label="Zona de dibujo de salas"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        const p = local(e);
        setStart(p);
        setCurrent(p);
      }}
      onPointerMove={(e) => {
        if (start) setCurrent(local(e));
      }}
      onPointerUp={finish}
    >
      {preview && (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-sky-600 bg-sky-400/10"
          style={{ left: preview.x, top: preview.y, width: preview.width, height: preview.height }}
        />
      )}
      <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded bg-sky-700 px-2 py-1 text-xs text-white">
        Arrastra para dibujar una sala rectangular (Esc para cancelar)
      </div>
    </div>
  );
}
