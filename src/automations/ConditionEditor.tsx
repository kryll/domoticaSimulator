import type { Condition } from '../types';
import { EntityPicker } from './EntityPicker';
import { CONDITION_LABELS, conditionFactories } from '../ui/automationOptions';
import { ListEditor } from './ListEditor';
import { TextField } from '../ui/Field';
import { parseNumberInput, parseStateInput, stateToInput } from '../ui/formValues';

export function ConditionEditor({ value, onChange }: { value: Condition; onChange: (c: Condition) => void }) {
  const header = <div className="mb-1 text-xs font-semibold text-slate-700">{CONDITION_LABELS[value.type]}</div>;
  switch (value.type) {
    case 'state':
      return (
        <div>
          {header}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <EntityPicker label="Entidad" value={value.entityId} onChange={(entityId) => onChange({ ...value, entityId })} />
            <TextField
              label="Estado"
              value={stateToInput(value.state)}
              onChange={(e) => onChange({ ...value, state: parseStateInput(e.target.value) ?? '' })}
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
  }
}
