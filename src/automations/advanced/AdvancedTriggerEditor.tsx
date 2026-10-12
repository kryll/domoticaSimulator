import { useMemo } from 'react';
import type { DeviceActionTrigger, ZoneTrigger } from '../../types';
import { useProjectStore } from '../../store/projectStore';
import { projectEntities } from '../../canvas/analysis';
import { BUTTON_ACTION_LABELS, isRemoteEntity } from '../../simulation/controls/labels';
import { SelectField } from '../../ui/Field';
import { ADVANCED_TRIGGER_LABELS } from '../../ui/advancedAutomationOptions';
import { PersonSelect, ZoneSelect } from '../../people/pickers';

function Header({ text }: { text: string }) {
  return <div className="mb-1 text-xs font-semibold text-slate-700">{text}</div>;
}

export function ZoneTriggerEditor({ value, onChange }: { value: ZoneTrigger; onChange: (t: ZoneTrigger) => void }) {
  return (
    <div>
      <Header text={ADVANCED_TRIGGER_LABELS.zone} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <PersonSelect value={value.personId} onChange={(personId) => onChange({ ...value, personId })} />
        <SelectField
          label="Evento"
          value={value.event}
          options={[
            { value: 'enter', label: 'Entra en' },
            { value: 'leave', label: 'Sale de' },
          ]}
          onChange={(e) => onChange({ ...value, event: e.target.value === 'leave' ? 'leave' : 'enter' })}
        />
        <ZoneSelect value={value.zoneId} onChange={(zoneId) => onChange({ ...value, zoneId })} />
      </div>
    </div>
  );
}

/** Mandos del proyecto (sensores de acción) con sus acciones posibles. */
function useRemotes() {
  const project = useProjectStore((s) => s.project);
  return useMemo(
    () =>
      projectEntities(project)
        .filter((r) => isRemoteEntity(r.definition))
        .map((r) => ({
          entityId: r.entityId,
          label: r.device.name,
          actions: r.definition.capabilities?.buttonActions ?? ['single', 'double', 'hold'],
        })),
    [project],
  );
}

export function DeviceActionTriggerEditor({
  value,
  onChange,
}: {
  value: DeviceActionTrigger;
  onChange: (t: DeviceActionTrigger) => void;
}) {
  const remotes = useRemotes();
  const current = remotes.find((r) => r.entityId === value.entityId);
  const actions = current?.actions ?? ['single', 'double', 'hold'];
  return (
    <div>
      <Header text={ADVANCED_TRIGGER_LABELS.device_action} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SelectField
          label="Mando"
          value={value.entityId}
          placeholder="— Elige un mando —"
          options={[
            ...remotes.map((r) => ({ value: r.entityId, label: r.label })),
            ...(value.entityId && !current ? [{ value: value.entityId, label: `${value.entityId} (no existe)` }] : []),
          ]}
          onChange={(e) => {
            const next = remotes.find((r) => r.entityId === e.target.value);
            const action = next && !next.actions.includes(value.action) ? (next.actions[0] ?? 'single') : value.action;
            onChange({ ...value, entityId: e.target.value, action });
          }}
          hint={remotes.length === 0 ? 'Añade un mando o botón inalámbrico al plano.' : undefined}
        />
        <SelectField
          label="Acción"
          value={value.action}
          options={[...new Set([...actions, value.action])].map((a) => ({ value: a, label: BUTTON_ACTION_LABELS[a] ?? a }))}
          onChange={(e) => onChange({ ...value, action: e.target.value })}
        />
      </div>
    </div>
  );
}
