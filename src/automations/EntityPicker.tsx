import { useMemo } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { projectEntities } from '../canvas/analysis';
import { Field, inputClass } from '../ui/Field';

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

/** Selector de entidades del proyecto agrupadas por dispositivo. */
export function EntityPicker({ label, value, onChange, domains, numericOnly }: EntityPickerProps) {
  const project = useProjectStore((s) => s.project);
  const states = useSimulationStore((s) => s.sim.entities);
  const groups = useMemo(() => {
    const map = new Map<string, Array<{ id: string; label: string }>>();
    for (const ref of projectEntities(project)) {
      if (domains && !domains.includes(ref.definition.domain)) continue;
      if (numericOnly) {
        const st = states[ref.entityId]?.state ?? ref.definition.initialState;
        if (ref.definition.domain !== 'sensor' || !isNumericValue(st)) continue;
      }
      const list = map.get(ref.device.name) ?? [];
      list.push({ id: ref.entityId, label: `${ref.definition.name} (${ref.entityId})` });
      map.set(ref.device.name, list);
    }
    return [...map.entries()];
  }, [project, domains, numericOnly, states]);
  const known = groups.some(([, list]) => list.some((e) => e.id === value));

  return (
    <Field label={label}>
      {(id) => (
        <select id={id} className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">— Elige una entidad —</option>
          {value && !known && <option value={value}>{value} (no existe)</option>}
          {groups.map(([device, list]) => (
            <optgroup key={device} label={device}>
              {list.map((e) => (
                <option key={e.id} value={e.id}>
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
