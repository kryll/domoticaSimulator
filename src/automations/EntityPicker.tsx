import { useMemo } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { projectEntities } from '../canvas/analysis';
import { Field, inputClass } from '../ui/Field';
import { disambiguate, entityLabel } from '../ui/entityLabel';

export interface EntityPickerProps {
  label: string;
  value: string;
  onChange: (entityId: string) => void;
  /** Limita a ciertos dominios (light, sensor...). */
  domains?: string[];
  /** Solo sensores con estado numérico (para disparadores y condiciones numéricas). */
  numericOnly?: boolean;
}

function isNumericValue(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  return typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v));
}

const NO_ROOM = 'Sin sala';

/** Selector de entidades del proyecto («Dispositivo · Entidad») agrupadas por sala. */
export function EntityPicker({ label, value, onChange, domains, numericOnly }: EntityPickerProps) {
  const project = useProjectStore((s) => s.project);
  const states = useSimulationStore((s) => s.sim.entities);
  const groups = useMemo(() => {
    const roomNames = new Map(project.rooms.map((r) => [r.id, r.name]));
    const items: Array<{ entityId: string; label: string; group: string }> = [];
    const all = projectEntities(project);
    const perDevice = new Map<string, number>();
    for (const ref of all) perDevice.set(ref.device.id, (perDevice.get(ref.device.id) ?? 0) + 1);
    for (const ref of all) {
      if (domains && !domains.includes(ref.definition.domain)) continue;
      if (numericOnly) {
        const st = states[ref.entityId]?.state ?? ref.definition.initialState;
        if (ref.definition.domain !== 'sensor' || !isNumericValue(st)) continue;
      }
      items.push({
        entityId: ref.entityId,
        label: entityLabel(ref.device.name, ref.definition.name, perDevice.get(ref.device.id) === 1),
        group: (ref.device.roomId && roomNames.get(ref.device.roomId)) || NO_ROOM,
      });
    }
    const map = new Map<string, Array<{ entityId: string; label: string }>>();
    for (const item of disambiguate(items)) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()].sort(([a], [b]) => (a === NO_ROOM ? 1 : b === NO_ROOM ? -1 : a.localeCompare(b, 'es')));
  }, [project, domains, numericOnly, states]);
  const known = groups.some(([, list]) => list.some((e) => e.entityId === value));

  return (
    <Field label={label}>
      {(id) => (
        <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} title={value || undefined}>
          <option value="">— Elige una entidad —</option>
          {value && !known && <option value={value}>{value} (no existe)</option>}
          {groups.map(([group, list]) => (
            <optgroup key={group} label={group}>
              {list.map((e) => (
                <option key={e.entityId} value={e.entityId} title={e.entityId}>
                  {e.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}
    </Field>
  );
}
