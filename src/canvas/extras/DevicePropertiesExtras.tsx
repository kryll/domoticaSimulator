import type { Device, EntityDefinition } from '../../types';
import { HistorySparkline } from '../../history/HistorySparkline';
import { definitionOf } from '../analysis';
import { setDeviceShowAs } from './showAs';

/** «Mostrar como luz» en los relés y enchufes (B19: Device.showAs). */
export function DeviceDisplayOptions({ device }: { device: Device }) {
  const def = definitionOf(device);
  if (!def?.entities.some((e) => e.domain === 'switch')) return null;
  const asLight = device.showAs === 'light';
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={asLight}
        onChange={(e) => setDeviceShowAs(device.id, e.target.checked ? 'light' : undefined)}
        className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
      />
      Mostrar como luz
      <span className="text-xs text-slate-500">(switch → light)</span>
    </label>
  );
}

/** Minigráfica de historial (B23): estado numérico o binario y atributos con historial. */
export function EntityHistory({ entityId, definition }: { entityId: string; definition: EntityDefinition }) {
  const binary = ['binary_sensor', 'switch', 'light', 'fan', 'lock'].includes(definition.domain);
  const numeric = definition.domain === 'sensor' && (definition.unit !== undefined || typeof definition.initialState === 'number');
  // Persianas, termostatos y reproductores: su estado es texto; se dibujan sus atributos.
  const attrsOnly = ['cover', 'climate', 'media_player'].includes(definition.domain);
  if (!binary && !numeric && !attrsOnly) return null;
  return <HistorySparkline entityId={entityId} unit={definition.unit} stateMode={binary ? 'binary' : numeric ? 'numeric' : 'none'} />;
}
