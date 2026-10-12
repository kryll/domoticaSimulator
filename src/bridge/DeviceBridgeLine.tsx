import type { Device, DeviceDefinition } from '../types';
import { useBridgeStore } from './bridgeStore';
import { useBridgeSettings } from './useBridge';
import { RADIO_LABEL, viaInfo } from './via';
import { NODE_STATE_LABELS } from './labels';

/** Línea «Vía hacia HA» de las propiedades del dispositivo (solo con el laboratorio activado). */
export function DeviceBridgeLine({ device, def }: { device: Device; def: DeviceDefinition | undefined }) {
  const settings = useBridgeSettings();
  const node = useBridgeStore((s) => s.status?.nodes[device.id]);
  if (!settings.enabled || !def) return null;
  const via = viaInfo(device, def);
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
        </p>
      )}
    </div>
  );
}
