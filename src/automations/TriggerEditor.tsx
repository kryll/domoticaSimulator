import type { Trigger } from '../types';
import { EntityPicker } from './EntityPicker';
import { TRIGGER_LABELS } from '../ui/automationOptions';
import { SelectField, TextField } from '../ui/Field';
import { parseNumberInput, parseStateInput, stateToInput } from '../ui/formValues';


export function TriggerEditor({ value, onChange }: { value: Trigger; onChange: (t: Trigger) => void }) {
  const header = <div className="mb-1 text-xs font-semibold text-slate-700">{TRIGGER_LABELS[value.type]}</div>;
  switch (value.type) {
    case 'state':
      return (
        <div>
          {header}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <EntityPicker label="Entidad" value={value.entityId} onChange={(entityId) => onChange({ ...value, entityId })} />
            <TextField
              label="Desde (opcional)"
              value={stateToInput(value.from)}
              placeholder="cualquiera"
              onChange={(e) => onChange({ ...value, from: parseStateInput(e.target.value) })}
            />
            <TextField
              label="Hasta (opcional)"
              value={stateToInput(value.to)}
              placeholder="on, off, open…"
              onChange={(e) => onChange({ ...value, to: parseStateInput(e.target.value) })}
            />
          </div>
        </div>
      );
    case 'numeric_state':
      return (
        <div>
          {header}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <EntityPicker
              label="Entidad"
              value={value.entityId}
              onChange={(entityId) => onChange({ ...value, entityId })}
              domains={['sensor', 'climate']}
            />
            <TextField
              label="Por encima de"
              type="number"
              value={value.above ?? ''}
              onChange={(e) => onChange({ ...value, above: parseNumberInput(e.target.value) })}
            />
            <TextField
              label="Por debajo de"
              type="number"
              value={value.below ?? ''}
              onChange={(e) => onChange({ ...value, below: parseNumberInput(e.target.value) })}
            />
          </div>
        </div>
      );
    case 'time':
      return (
        <div>
          {header}
          <TextField label="A las" type="time" value={value.at} onChange={(e) => onChange({ ...value, at: e.target.value })} />
        </div>
      );
    case 'sun':
      return (
        <div>
          {header}
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="Evento"
              value={value.event}
              options={[
                { value: 'sunrise', label: 'Amanecer' },
                { value: 'sunset', label: 'Atardecer' },
              ]}
              onChange={(e) => onChange({ ...value, event: e.target.value as 'sunrise' | 'sunset' })}
            />
            <TextField
              label="Desfase (minutos)"
              type="number"
              value={value.offsetMinutes ?? ''}
              onChange={(e) => onChange({ ...value, offsetMinutes: parseNumberInput(e.target.value) })}
            />
          </div>
        </div>
      );
  }
}
