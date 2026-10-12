import type { Condition, NotCondition, ZoneCondition } from '../../types';
import { conditionFactories } from '../../ui/automationOptions';
import { ADVANCED_CONDITION_LABELS } from '../../ui/advancedAutomationOptions';
import { ListEditor } from '../ListEditor';
import { ConditionEditor } from '../ConditionEditor';
import { PersonSelect, ZoneSelect } from '../../people/pickers';

/** Lista anidable de condiciones (reutilizada por not, choose, if y repeat). */
export function ConditionListEditor({
  title,
  conditions,
  onChange,
  emptyText = 'Sin condiciones.',
}: {
  title: string;
  conditions: Condition[];
  onChange: (conditions: Condition[]) => void;
  emptyText?: string;
}) {
  return (
    <ListEditor<Condition>
      title={title}
      items={conditions}
      onChange={onChange}
      renderItem={(c, update) => <ConditionEditor value={c} onChange={update} />}
      addOptions={conditionFactories}
      emptyText={emptyText}
    />
  );
}

export function NotConditionEditor({ value, onChange }: { value: NotCondition; onChange: (c: NotCondition) => void }) {
  return (
    <ConditionListEditor
      title={ADVANCED_CONDITION_LABELS.not}
      conditions={value.conditions}
      onChange={(conditions) => onChange({ ...value, conditions })}
      emptyText="Se cumple si no se cumple ninguna de estas condiciones."
    />
  );
}

export function ZoneConditionEditor({ value, onChange }: { value: ZoneCondition; onChange: (c: ZoneCondition) => void }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-slate-700">{ADVANCED_CONDITION_LABELS.zone}</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <PersonSelect value={value.personId} onChange={(personId) => onChange({ ...value, personId })} />
        <ZoneSelect value={value.zoneId} onChange={(zoneId) => onChange({ ...value, zoneId })} />
      </div>
    </div>
  );
}
