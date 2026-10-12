import type { Condition } from '../types';
import { EntityPicker } from './EntityPicker';
import { CONDITION_LABELS, conditionFactories } from '../ui/automationOptions';
import { ListEditor } from './ListEditor';
import { SelectField, TextField } from '../ui/Field';
import { parseNumberInput } from '../ui/formValues';
import { StateSelect } from './StateSelect';
import { DurationField } from './DurationField';
import { NotConditionEditor, ZoneConditionEditor } from './advanced/ConditionListEditor';
import { TriggerConditionEditor } from './TriggerConditionEditor';

export function ConditionEditor({ value, onChange }: { value: Condition; onChange: (c: Condition) => void }) {
  const header = <div className="mb-1 text-xs font-semibold text-slate-700">{CONDITION_LABELS[value.type]}</div>;
  switch (value.type) {
    case 'state':
      return (
        <div>
          {header}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr,1fr,1fr]">
            <EntityPicker label="Entidad" value={value.entityId} onChange={(entityId) => onChange({ ...value, entityId })} />
            <StateSelect
              label="Estado"
              entityId={value.entityId}
              value={value.state === '' ? undefined : value.state}
              onChange={(state) => onChange({ ...value, state: state ?? '' })}
            />
            <DurationField
              label="Desde hace al menos (min:s)"
              value={value.for}
              onChange={(sec) => {
                const next = { ...value };
                if (sec === undefined) delete next.for;
                else next.for = sec;
                onChange(next);
              }}
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
          <div className="grid grid-cols-2 gap-2">
            <TextField
              label="Después de"
              type="time"
              value={value.after ?? ''}
              onChange={(e) => onChange({ ...value, after: e.target.value || undefined })}
            />
            <TextField
              label="Antes de"
              type="time"
              value={value.before ?? ''}
              onChange={(e) => onChange({ ...value, before: e.target.value || undefined })}
            />
          </div>
        </div>
      );
    case 'sun': {
      const eventOptions = [
        { value: 'sunrise', label: 'Amanecer' },
        { value: 'sunset', label: 'Atardecer' },
      ];
      const night = value.after === 'sunset' && value.before === 'sunrise';
      const day = value.after === 'sunrise' && value.before === 'sunset';
      return (
        <div>
          {header}
          <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Atajos de la condición de sol">
            <button
              type="button"
              aria-pressed={night}
              className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs aria-pressed:border-indigo-500 aria-pressed:bg-indigo-50"
              onClick={() => onChange({ type: 'sun', after: 'sunset', before: 'sunrise' })}
            >
              🌙 Es de noche
            </button>
            <button
              type="button"
              aria-pressed={day}
              className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs aria-pressed:border-amber-500 aria-pressed:bg-amber-50"
              onClick={() => onChange({ type: 'sun', after: 'sunrise', before: 'sunset' })}
            >
              ☀️ Es de día
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SelectField
              label="Después de"
              value={value.after ?? ''}
              placeholder="—"
              options={eventOptions}
              onChange={(e) => {
                const next = { ...value };
                if (e.target.value === '') delete next.after;
                else next.after = e.target.value as 'sunrise' | 'sunset';
                onChange(next);
              }}
            />
            <TextField
              label="Desfase después (min)"
              type="number"
              value={value.afterOffsetMinutes ?? ''}
              disabled={!value.after}
              onChange={(e) => onChange({ ...value, afterOffsetMinutes: parseNumberInput(e.target.value) })}
            />
            <SelectField
              label="Antes de"
              value={value.before ?? ''}
              placeholder="—"
              options={eventOptions}
              onChange={(e) => {
                const next = { ...value };
                if (e.target.value === '') delete next.before;
                else next.before = e.target.value as 'sunrise' | 'sunset';
                onChange(next);
              }}
            />
            <TextField
              label="Desfase antes (min)"
              type="number"
              value={value.beforeOffsetMinutes ?? ''}
              disabled={!value.before}
              onChange={(e) => onChange({ ...value, beforeOffsetMinutes: parseNumberInput(e.target.value) })}
            />
          </div>
        </div>
      );
    }
    case 'and':
    case 'or':
      return (
        <ListEditor<Condition>
          title={CONDITION_LABELS[value.type]}
          items={value.conditions}
          onChange={(conditions) => onChange({ ...value, conditions })}
          renderItem={(c, update) => <ConditionEditor value={c} onChange={update} />}
          addOptions={conditionFactories}
          emptyText="Sin condiciones anidadas."
        />
      );
    case 'not':
      return <NotConditionEditor value={value} onChange={onChange} />;
    case 'zone':
      return <ZoneConditionEditor value={value} onChange={onChange} />;
    case 'trigger':
      return (
        <div>
          {header}
          <TriggerConditionEditor value={value} onChange={onChange} />
        </div>
      );
  }
}
