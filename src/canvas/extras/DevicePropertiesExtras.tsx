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

/** Minigráfica de historial para entidades numéricas o binarias (B23). */
export function EntityHistory({ entityId, definition }: { entityId: string; definition: EntityDefinition }) {
  const binary = definition.domain === 'binary_sensor' || definition.domain === 'switch' || definition.domain === 'light';
  const numeric = definition.domain === 'sensor' && (definition.unit !== undefined || typeof definition.initialState === 'number');
  if (!binary && !numeric) return null;
  return <HistorySparkline entityId={entityId} unit={definition.unit} binary={binary} />;
}
