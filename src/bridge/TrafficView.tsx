import { useMemo, useState } from 'react';
import { useBridgeStore } from './bridgeStore';
import { filterTraffic, type TrafficDirection } from './protocol';
import { useProjectStore } from '../store/projectStore';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/Field';
import { downloadText } from '../ui/download';

const MAX_ROWS = 500;

function time(t: number): string {
  const d = new Date(t);
  return `${d.toLocaleTimeString('es-ES', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/** Inspector de tráfico del laboratorio (el «Wireshark» del lab): MQTT, tramas Z-Wave y API de ESPHome. */
export function TrafficView() {
  const traffic = useBridgeStore((s) => s.traffic);
  const paused = useBridgeStore((s) => s.trafficPaused);
  const devices = useProjectStore((s) => s.project.devices);
  const [deviceId, setDeviceId] = useState('');
  const [dir, setDir] = useState<'' | TrafficDirection>('');
  const [topic, setTopic] = useState('');
  const filtered = useMemo(() => filterTraffic(traffic, { deviceId, ...(dir ? { dir } : {}), topic }), [traffic, deviceId, dir, topic]);
  const rows = filtered.slice(-MAX_ROWS).reverse();
  const names = useMemo(() => new Map(devices.map((d) => [d.id, d.name])), [devices]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Filtros del tráfico">
        <label className="flex flex-col text-xs text-slate-600">
          Dispositivo
          <select className={inputClass} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">Todos</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-600">
          Sentido
          <select className={inputClass} value={dir} onChange={(e) => setDir(e.target.value as '' | TrafficDirection)}>
            <option value="">Los dos</option>
            <option value="out">Hacia HA (publicado)</option>
            <option value="in">Desde HA (recibido)</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col text-xs text-slate-600">
          Topic o vía (texto o patrón con + y #; «zwave», «esphome», «matter»)
          <input className={inputClass} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="p. ej. hasim-z2m/+/set" />
        </label>
        <Button size="sm" onClick={() => useBridgeStore.getState().setTrafficPaused(!paused)} aria-pressed={paused}>
          {paused ? '▶ Reanudar' : '⏸ Pausar'}
        </Button>
        <Button size="sm" onClick={() => useBridgeStore.getState().clearTraffic()}>
          Vaciar
        </Button>
        <Button size="sm" onClick={() => downloadText(JSON.stringify(filtered, null, 2), 'trafico-lab.json', 'application/json')} disabled={filtered.length === 0}>
          Exportar JSON
        </Button>
      </div>
      <p className="text-xs text-slate-500" aria-live="polite">
        {filtered.length} de {traffic.length} mensajes{paused ? ' · en pausa' : ''}
        {filtered.length > MAX_ROWS ? ` · se muestran los ${MAX_ROWS} más recientes` : ''}
      </p>
      <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200">
        <table className="w-full table-fixed text-left font-mono text-[11px]">
          <thead className="sticky top-0 bg-slate-100 text-slate-600">
            <tr>
              <th className="w-24 px-1 py-0.5">Hora</th>
              <th className="w-10 px-1 py-0.5">Sent.</th>
              <th className="w-32 px-1 py-0.5">Dispositivo</th>
              <th className="w-64 px-1 py-0.5">Topic / vía</th>
              <th className="px-1 py-0.5">Payload</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.seq} className="border-t border-slate-100 align-top">
                <td className="px-1 py-0.5 text-slate-500">{time(e.t)}</td>
                <td className="px-1 py-0.5" title={e.dir === 'out' ? 'Publicado por el lab' : 'Recibido de HA'}>
                  {e.dir === 'out' ? '→' : '←'}
                </td>
                <td className="truncate px-1 py-0.5">{e.deviceId ? (names.get(e.deviceId) ?? e.deviceId) : '—'}</td>
                <td className="break-all px-1 py-0.5">
                  {e.via && e.via !== 'mqtt' && <span className="mr-1 rounded bg-violet-50 px-1 text-violet-800">{e.via === 'zwave' ? 'Z-Wave' : e.via === 'matter' ? 'Matter' : 'ESPHome'}</span>}
                  {e.topic}
                  {e.retain && <span className="ml-1 text-amber-700">(retenido)</span>}
                </td>
                <td className="break-all px-1 py-0.5 text-slate-700">{e.payload === '' ? <em className="text-slate-400">vacío (borra el retenido)</em> : e.payload}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-3 text-xs text-slate-500">Sin mensajes. El tráfico aparece aquí mientras esta pestaña está abierta.</p>}
      </div>
    </div>
  );
}
