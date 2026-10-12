import type { Action } from '../types';
import { useProjectStore } from '../store/projectStore';
import { EntityPicker } from './EntityPicker';
import { ACTION_LABELS, actionFactories } from '../ui/automationOptions';
import { ListEditor } from './ListEditor';
import { Field, SelectField, TextField, inputClass } from '../ui/Field';
import { dataToInput, parseDataInput, parseNumberInput, servicesForEntity } from '../ui/formValues';

export function ActionEditor({ value, onChange }: { value: Action; onChange: (a: Action) => void }) {
  const scenes = useProjectStore((s) => s.project.scenes);
  const scripts = useProjectStore((s) => s.project.scripts);
  const header = <div className="mb-1 text-xs font-semibold text-slate-700">{ACTION_LABELS[value.type]}</div>;

  switch (value.type) {
    case 'service': {
      const services = value.entityId ? servicesForEntity(value.entityId) : [];
      const listId = `services-${value.entityId || 'none'}`;
      return (
        <div>
          {header}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <EntityPicker
              label="Entidad"
              value={value.entityId}
              onChange={(entityId) => {
                const first = servicesForEntity(entityId)[0] ?? '';
                const keep = value.service && value.service.split('.')[0] === entityId.split('.')[0];
                onChange({ ...value, entityId, service: keep ? value.service : first });
              }}
            />
            <Field label="Servicio">
              {(id) => (
                <>
                  <input
                    id={id}
                    list={listId}
                    className={inputClass}
                    value={value.service}
                    placeholder="light.turn_on"
                    onChange={(e) => onChange({ ...value, service: e.target.value })}
                  />
                  <datalist id={listId}>
                    {services.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <TextField
              label="Datos (clave=valor)"
              placeholder="brightness=200"
              defaultValue={dataToInput(value.data)}
              onBlur={(e) => onChange({ ...value, data: parseDataInput(e.target.value) })}
            />
          </div>
        </div>
      );
    }
    case 'scene':
      return (
        <div>
          {header}
          <SelectField
            label="Escena"
            value={value.sceneId}
            placeholder="— Elige una escena —"
            options={scenes.map((s) => ({ value: s.id, label: s.name }))}
            onChange={(e) => onChange({ ...value, sceneId: e.target.value })}
          />
        </div>
      );
    case 'script':
      return (
        <div>
          {header}
          <SelectField
            label="Script"
            value={value.scriptId}
            placeholder="— Elige un script —"
            options={scripts.map((s) => ({ value: s.id, label: s.name }))}
            onChange={(e) => onChange({ ...value, scriptId: e.target.value })}
          />
        </div>
      );
    case 'delay':
      return (
        <div>
          {header}
          <TextField
            label="Segundos"
            type="number"
            min={0}
            value={value.seconds}
            onChange={(e) => onChange({ ...value, seconds: Math.max(0, parseNumberInput(e.target.value) ?? 0) })}
          />
        </div>
      );
  }
}

export function ActionListEditor({
  actions,
  onChange,
  title = 'Acciones',
}: {
  actions: Action[];
  onChange: (a: Action[]) => void;
  title?: string;
}) {
  return (
    <ListEditor<Action>
      title={title}
      items={actions}
      onChange={onChange}
      renderItem={(a, update) => <ActionEditor value={a} onChange={update} />}
      addOptions={actionFactories}
      emptyText="Sin acciones."
    />
  );
}
