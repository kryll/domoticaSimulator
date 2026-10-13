import type { Device, DeviceDefinition } from '../types';
import { useBridgeStore } from './bridgeStore';
import { useLocalLab } from './localLab';
import { RADIO_LABEL, viaInfo } from './via';
import { NODE_STATE_LABELS } from './labels';
import { useActiveNative } from './useBridge';

/** Línea «Vía hacia HA» de las propiedades del dispositivo (solo con el laboratorio activado). */
export function DeviceBridgeLine({ device, def }: { device: Device; def: DeviceDefinition | undefined }) {
  const enabled = useLocalLab((s) => s.enabled);
  const node = useBridgeStore((s) => s.status?.nodes[device.id]);
  const native = useBridgeStore((s) => s.status?.native);
  const active = useActiveNative();
  if (!enabled || !def) return null;
  const via = viaInfo(device, def, active);
  const real = (via.transport === 'zwave_js' || via.transport === 'esphome' || via.transport === 'matter') && !via.pending ? native?.[via.transport]?.nodes[device.id] : undefined;
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700" aria-label="Laboratorio">
      <p>
        <span className="font-semibold">Vía hacia HA:</span> {via.label}
      </p>
      {via.note && <p className="text-slate-500">{via.note}</p>}
      <p className="text-slate-500">{RADIO_LABEL}</p>
      {node && (
        <p>
          <span className="font-semibold">Nodo:</span> {NODE_STATE_LABELS[node]}
          {real?.detail ? ` · ${real.detail}` : ''}
        </p>
      )}
    </div>
  );
}
