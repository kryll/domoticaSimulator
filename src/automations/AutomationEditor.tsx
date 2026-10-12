import { useId, useMemo } from 'react';
import { knownDefinitions } from '../canvas/analysis';
import type { Automation, Condition, Trigger } from '../types';
import { Tabs } from '../ui/Tabs';
import { tabPanelId } from '../ui/ids';
import { SelectField, TextAreaField, TextField } from '../ui/Field';
import { ListEditor } from './ListEditor';
import { TriggerEditor } from './TriggerEditor';
import { ConditionEditor } from './ConditionEditor';
import { ActionListEditor } from './ActionEditor';
import { AutomationScope } from './advanced/VariableHelp';
import { AutomationYamlEditor } from './AutomationYamlEditor';
import { conditionFactories, triggerFactories } from '../ui/automationOptions';
import { useUiStore, type AutomationView } from '../store/uiStore';
import { TracesView } from './TracesView';
import { TriggerIdsContext } from './triggerIdsContext';
import { useProjectStore } from '../store/projectStore';
import { describeAutomation } from '../report/describe';
import { isPlaceholderName, suggestAutomationName } from './autoName';

export interface AutomationEditorProps {
  automation: Automation;
  onChange: (automation: Automation) => void;
}

/** Editor visual + YAML de una automatización. */
export function AutomationEditor({ automation, onChange: emit }: AutomationEditorProps) {
  const project = useProjectStore((s) => s.project);
  const description = useMemo(() => describeAutomation(automation, project, knownDefinitions()), [automation, project]);
  const suggestion = useMemo(() => suggestAutomationName(description), [description]);
  // Mientras el nombre sea provisional o el propuesto, se va actualizando con la descripción.
  const autoNamed = isPlaceholderName(automation.name) || automation.name === suggestion;
  const onChange = (next: Automation) => {
    if (!autoNamed || next.name !== automation.name) {
      emit(next);
      return;
    }
    const nextSuggestion = suggestAutomationName(describeAutomation(next, project, knownDefinitions()));
    emit(next.triggers.length > 0 || next.actions.length > 0 ? { ...next, name: nextSuggestion } : next);
  };
  const prefix = `auto-${useId().replace(/:/g, '')}`;
  const view = useUiStore((s) => s.automationView);
  const setView = useUiStore((s) => s.setAutomationView);
  const triggerIds = useMemo(
    () => [...new Set(automation.triggers.map((t) => t.id).filter((id): id is string => typeof id === 'string' && id !== ''))],
    [automation.triggers],
  );
  const set = <K extends keyof Automation>(key: K, value: Automation[K]) => onChange({ ...automation, [key]: value });

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950" aria-live="polite" data-testid="automation-description">
        <span className="sr-only">Descripción: </span>
        {description}.
      </p>
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
        <TriggerIdsContext.Provider value={triggerIds}>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,auto,auto] sm:items-end">
            <div className="flex flex-col gap-1">
              <TextField
                label="Nombre de la automatización"
                value={automation.name}
                onChange={(e) => set('name', e.target.value)}
                hint={autoNamed ? 'Se propone a partir de lo que hace; escribe otro si quieres.' : undefined}
              />
              {!autoNamed && suggestion !== automation.name && (
                <button
                  type="button"
                  onClick={() => set('name', suggestion)}
                  className="self-start text-left text-xs font-medium text-sky-800 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                >
                  Usar el nombre propuesto: «{suggestion}»
                </button>
              )}
            </div>
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
          <TextAreaField
            label="Descripción (opcional)"
            rows={2}
            value={automation.description ?? ''}
            onChange={(e) => {
              const next: Automation = { ...automation, description: e.target.value };
              if (e.target.value === '') delete next.description;
              onChange(next);
            }}
          />
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
          <AutomationScope triggerTypes={automation.triggers.map((t) => t.type)}>
            <ActionListEditor actions={automation.actions} onChange={(actions) => set('actions', actions)} />
          </AutomationScope>
        </div>
        </TriggerIdsContext.Provider>
      ) : (
        <AutomationYamlEditor automation={automation} onChange={onChange} />
      )}
      </div>
    </div>
  );
}
