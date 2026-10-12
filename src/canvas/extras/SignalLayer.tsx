import { useEffect, useMemo, useRef } from 'react';
import { knownDefinitions } from '../analysis';
import { ViewportPortal } from '@xyflow/react';
import type { Floor, Project } from '../../types';
import { PROTOCOL_LABELS } from '../../devices/catalog';
import { heatSourcesFor, rssiHeatmap, type Heatmap } from '../../network/walls';
import { useExtrasStore, type SignalProtocol } from '../../store/extrasStore';
import { heatGridFor, marginRgba, SIGNAL_LEGEND } from './signalGrid';

/** Devuelve el array anterior si tiene los mismos elementos (por referencia). */
function useStableList<T>(list: T[]): T[] {
  const ref = useRef(list);
  const prev = ref.current;
  if (prev !== list && (prev.length !== list.length || prev.some((x, i) => x !== list[i]))) ref.current = list;
  return ref.current;
}

/**
 * Mapa de calor del protocolo elegido. Solo se recalcula si cambian los dispositivos o las salas
 * de la planta, sus paredes o escala, o el protocolo (no con cualquier cambio del proyecto).
 */
function useHeatmap(project: Project, floor: Floor, protocol: SignalProtocol): { map: Heatmap | null; sources: number } {
  const devices = useStableList(project.devices.filter((d) => d.floorId === floor.id));
  const rooms = useStableList(project.rooms.filter((r) => r.floorId === floor.id));
  const projectRef = useRef(project);
  projectRef.current = project;
  const { walls, pixelsPerMeter, id } = floor;
  return useMemo(() => {
    // Solo lo que afecta a la señal: escala y paredes.
    const local: Floor = { id, name: '', level: 0, pixelsPerMeter, ...(walls ? { walls } : {}) };
    const sources = heatSourcesFor({ ...projectRef.current, devices }, knownDefinitions(), id, protocol);
    const points = [...devices.map((d) => d.position), ...rooms.flatMap((r) => r.polygon)];
    const grid = heatGridFor(local, points);
    if (!grid || sources.length === 0) return { map: null, sources: sources.length };
    return { map: rssiHeatmap(local, sources, grid), sources: sources.length };
  }, [devices, rooms, walls, pixelsPerMeter, id, protocol]);
}

/** Capa «Señal»: canvas por debajo de los nodos con el mapa de RSSI (B21). */
export function SignalLayer({ project, floor }: { project: Project; floor: Floor }) {
  const protocol = useExtrasStore((s) => s.signalProtocol);
  const { map } = useHeatmap(project, floor, protocol);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !map) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(map.cols, map.rows);
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        const [red, g, b, a] = marginRgba(map.values[r]?.[c] ?? -Infinity);
        const i = (r * map.cols + c) * 4;
        img.data[i] = red;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        img.data[i + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [map]);

  if (!map) return null;
  const { grid } = map;
  return (
    <ViewportPortal>
      <canvas
        ref={ref}
        width={map.cols}
        height={map.rows}
        className="pointer-events-none absolute"
        style={{ left: grid.x0, top: grid.y0, width: map.cols * grid.step, height: map.rows * grid.step, zIndex: -1 }}
        aria-hidden="true"
        data-testid="signal-layer"
      />
    </ViewportPortal>
  );
}

const PROTOCOLS: SignalProtocol[] = ['zigbee', 'wifi', 'thread', 'zwave'];

/** Leyenda de la capa «Señal» con el protocolo a mostrar. */
export function SignalLegend({ project, floor }: { project: Project; floor: Floor }) {
  const protocol = useExtrasStore((s) => s.signalProtocol);
  const setProtocol = useExtrasStore((s) => s.setSignalProtocol);
  const sources = useMemo(() => heatSourcesFor(project, knownDefinitions(), floor.id, protocol).length, [project, floor.id, protocol]);
  return (
    <div className="flex flex-col gap-1 rounded-md border border-slate-200 bg-white/95 px-2 py-1 text-xs shadow-sm" data-export-ignore="">
      <label className="flex items-center gap-1 font-semibold text-slate-700">
        Señal
        <select
          value={protocol}
          onChange={(e) => setProtocol(e.target.value as SignalProtocol)}
          className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs font-normal"
          aria-label="Protocolo del mapa de señal"
        >
          {PROTOCOLS.map((p) => (
            <option key={p} value={p}>
              {PROTOCOL_LABELS[p]}
            </option>
          ))}
        </select>
      </label>
      {sources === 0 ? (
        <span className="text-slate-600">No hay emisores {PROTOCOL_LABELS[protocol]} en esta planta.</span>
      ) : (
        <ul className="flex flex-wrap gap-x-2 gap-y-0.5">
          {SIGNAL_LEGEND.map((l) => {
            const [r, g, b] = marginRgba(l.margin);
            return (
              <li key={l.label} className="flex items-center gap-1 text-slate-600">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: `rgb(${r}, ${g}, ${b})` }} aria-hidden="true" />
                {l.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
