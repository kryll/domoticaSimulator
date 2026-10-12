import { useId } from 'react';
import type { Automation, Condition, Trigger } from '../types';
import { Tabs } from '../ui/Tabs';
import { tabPanelId } from '../ui/ids';
import { SelectField, TextField } from '../ui/Field';
import { ListEditor } from './ListEditor';
import { TriggerEditor } from './TriggerEditor';
import { ConditionEditor } from './ConditionEditor';
import { ActionListEditor } from './ActionEditor';
import { AutomationYamlEditor } from './AutomationYamlEditor';
import { conditionFactories, triggerFactories } from '../ui/automationOptions';
import { useUiStore, type AutomationView } from '../store/uiStore';
import { TracesView } from './TracesView';

export interface AutomationEditorProps {
  automation: Automation;
  onChange: (automation: Automation) => void;
}

/** Editor visual + YAML de una automatización. */
export function AutomationEditor({ automation, onChange }: AutomationEditorProps) {
  const prefix = `auto-${useId().replace(/:/g, '')}`;
  const view = useUiStore((s) => s.automationView);
  const setView = useUiStore((s) => s.setAutomationView);
  const set = <K extends keyof Automation>(key: K, value: Automation[K]) => onChange({ ...automation, [key]: value });

  return (
    <div className="flex flex-col gap-3">
      <Tabs<AutomationView>
        label="Modo de edición"
        tabs={[
          { key: 'visual', label: 'Visual' },
          { key: 'yaml', label: 'YAML' },
          { key: 'traces', label: 'Trazas' },
        ]}
        active={view}
        onChange={setView}
        className="border-b border-slate-200"
        idPrefix={prefix}
      />
      <div role="tabpanel" id={tabPanelId(prefix, view)} aria-labelledby={`${prefix}-tab-${view}`}>
      {view === 'traces' ? (
        <TracesView automation={automation} />
      ) : view === 'visual' ? (
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
    </div>
  );
}
