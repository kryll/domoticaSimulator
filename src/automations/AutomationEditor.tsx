import { useState } from 'react';
import type { Automation, Condition, Trigger } from '../types';
import { Tabs } from '../ui/Tabs';
import { SelectField, TextField } from '../ui/Field';
import { ListEditor } from './ListEditor';
import { TriggerEditor } from './TriggerEditor';
import { ConditionEditor } from './ConditionEditor';
import { ActionListEditor } from './ActionEditor';
import { AutomationYamlEditor } from './AutomationYamlEditor';
import { conditionFactories, triggerFactories } from '../ui/automationOptions';

type View = 'visual' | 'yaml';

export interface AutomationEditorProps {
  automation: Automation;
  onChange: (automation: Automation) => void;
}

/** Editor visual + YAML de una automatización. */
export function AutomationEditor({ automation, onChange }: AutomationEditorProps) {
  const [view, setView] = useState<View>('visual');
  const set = <K extends keyof Automation>(key: K, value: Automation[K]) => onChange({ ...automation, [key]: value });

  return (
    <div className="flex flex-col gap-3">
      <Tabs<View>
        label="Modo de edición"
        tabs={[
          { key: 'visual', label: 'Visual' },
          { key: 'yaml', label: 'YAML' },
        ]}
        active={view}
        onChange={setView}
        className="border-b border-slate-200"
      />
      {view === 'visual' ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,auto,auto] sm:items-end">
            <TextField label="Nombre de la automatización" value={automation.name} onChange={(e) => set('name', e.target.value)} />
            <SelectField
              label="Modo"
              value={automation.mode}
              options={[
                { value: 'single', label: 'Única (single)' },
                { value: 'restart', label: 'Reiniciar (restart)' },
                { value: 'queued', label: 'En cola (queued)' },
                { value: 'parallel', label: 'Paralelo (parallel)' },
              ]}
              onChange={(e) => set('mode', e.target.value as Automation['mode'])}
            />
            <label className="flex items-center gap-2 pb-1 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={automation.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
              />
              Activada
            </label>
          </div>
          <ListEditor<Trigger>
            title="Disparadores"
            items={automation.triggers}
            onChange={(triggers) => set('triggers', triggers)}
            renderItem={(t, update) => <TriggerEditor value={t} onChange={update} />}
            addOptions={triggerFactories}
            emptyText="Añade al menos un disparador."
          />
          <ListEditor<Condition>
            title="Condiciones"
            items={automation.conditions}
            onChange={(conditions) => set('conditions', conditions)}
            renderItem={(c, update) => <ConditionEditor value={c} onChange={update} />}
            addOptions={conditionFactories}
            emptyText="Sin condiciones: se ejecuta siempre que se dispare."
          />
          <ActionListEditor actions={automation.actions} onChange={(actions) => set('actions', actions)} />
        </div>
      ) : (
        <AutomationYamlEditor automation={automation} onChange={onChange} />
      )}
    </div>
  );
}
