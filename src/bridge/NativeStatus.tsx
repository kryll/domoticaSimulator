// Estado de las vías reales del laboratorio (Z-Wave JS UI, nodos ESPHome) con su enlace.
import { useBridgeStore } from './bridgeStore';
import { NATIVE_STATE_LABELS } from './labels';
import { TRANSPORT_LABELS } from './via';
import { Badge, type BadgeTone } from '../ui/Badge';
import type { NativeServiceState, NativeStatus as NativeStatusInfo } from './protocol';

const TONE: Record<NativeServiceState, BadgeTone> = { disabled: 'slate', connecting: 'amber', connected: 'green', error: 'red' };

const LINK_LABEL: Record<'zwave_js' | 'esphome' | 'shelly', string> = { zwave_js: 'Abrir Z-Wave JS UI', esphome: '', shelly: '' };

/** Una línea por vía real activa: nombre, estado, detalle y enlace a su interfaz. */
export function NativeStatusList({ compact = false }: { compact?: boolean }) {
  const native = useBridgeStore((s) => s.status?.native);
  const entries = Object.entries(native ?? {}) as Array<['zwave_js' | 'esphome' | 'shelly', NativeStatusInfo]>;
  if (entries.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1" aria-label="Vías reales del laboratorio">
      {entries.map(([t, st]) => (
        <li key={t} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-700">
          <span className="font-medium">{TRANSPORT_LABELS[t]}:</span>
          <Badge tone={TONE[st.state]}>{NATIVE_STATE_LABELS[st.state]}</Badge>
          {!compact && <span className="text-slate-600">{st.detail}</span>}
          {st.url && LINK_LABEL[t] && (
            <a className="font-medium text-sky-800 underline" href={st.url} target="_blank" rel="noreferrer">
              {LINK_LABEL[t]}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
