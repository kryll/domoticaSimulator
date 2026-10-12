import type { Trigger } from '../types';
import { EntityPicker } from './EntityPicker';
import { TRIGGER_LABELS } from '../ui/automationOptions';
import { SelectField, TextField } from '../ui/Field';
import { parseNumberInput } from '../ui/formValues';
import { StateSelect } from './StateSelect';
import { DurationField } from './DurationField';
import { DeviceActionTriggerEditor, ZoneTriggerEditor } from './advanced/AdvancedTriggerEditor';

function withFor<T extends { for?: number }>(value: T, seconds: number | undefined): T {
  const next = { ...value };
  if (seconds === undefined) delete next.for;
  else next.for = seconds;
  return next;
}

function TriggerFields({ value, onChange }: { value: Trigger; onChange: (t: Trigger) => void }) {
  const header = <div className="mb-1 text-xs font-semibold text-slate-700">{TRIGGER_LABELS[value.type]}</div>;
  switch (value.type) {
    case 'state':
      return (
        <div>
          {header}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr,1fr,1fr,1fr]">
            <EntityPicker label="Entidad" value={value.entityId} onChange={(entityId) => onChange({ ...value, entityId })} />
            <StateSelect
              label="Desde (opcional)"
              entityId={value.entityId}
              value={value.from}
              emptyLabel="Cualquiera"
              onChange={(from) => onChange({ ...value, from })}
            />
            <StateSelect
              label="Hasta (opcional)"
              entityId={value.entityId}
              value={value.to}
              emptyLabel="Cualquiera"
              onChange={(to) => onChange({ ...value, to })}
            />
            <DurationField value={value.for} onChange={(sec) => onChange(withFor(value, sec))} />
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
              numericOnly
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
    case 'zone':
      return <ZoneTriggerEditor value={value} onChange={onChange} />;
    case 'device_action':
      return <DeviceActionTriggerEditor value={value} onChange={onChange} />;
  }
}

/** Disparador con su «ID del disparador» opcional (`id:` de HA, para la condición «Disparado por»). */
export function TriggerEditor({ value, onChange }: { value: Trigger; onChange: (t: Trigger) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <TriggerFields value={value} onChange={onChange} />
      <div className="max-w-xs">
        <TextField
          label="ID del disparador (opcional)"
          placeholder="p. ej. llegada"
          value={value.id ?? ''}
          onChange={(e) => {
            const id = e.target.value.trim();
            const next = { ...value };
            if (id === '') delete next.id;
            else next.id = id;
            onChange(next);
          }}
        />
      </div>
    </div>
  );
}
