import { useId, useMemo, useState } from 'react';
import type { Action } from '../types';
import { useProjectStore } from '../store/projectStore';
import { EntityPicker } from './EntityPicker';
import { ACTION_LABELS, actionFactories } from '../ui/automationOptions';
import { ListEditor } from './ListEditor';
import { Field, SelectField, TextField, inputClass } from '../ui/Field';
import { dataToInput, parseDataInput, parseNumberInput } from '../ui/formValues';
import { servicesForDomain } from '../simulation/serviceCatalog';
import { entityCapabilities } from '../devices/capabilities';
import { entityDomain } from '../devices/entities';
import { ServiceDataFields } from './ServiceDataFields';

type ActionData = Extract<Action, { type: 'service' }>['data'];

function sameData(a: ActionData, b: ActionData): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

/** Campo «Datos» controlado: borrador local que se resincroniza si value cambia desde fuera. */
function DataField({ value, onChange }: { value: ActionData; onChange: (data: ActionData) => void }) {
  const [draft, setDraft] = useState(() => dataToInput(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (!sameData(parseDataInput(draft), value)) setDraft(dataToInput(value));
  }
  return (
    <TextField
      label="Datos (clave=valor)"
      placeholder="brightness=200"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const parsed = parseDataInput(e.target.value);
        if (!sameData(parsed, value)) onChange(parsed);
      }}
    />
  );
}

type ServiceAction = Extract<Action, { type: 'service' }>;

/** Entidad, servicio (filtrado por el dominio) y datos tipados, con modo «Avanzado» de texto libre. */
function ServiceActionEditor({ value, onChange }: { value: ServiceAction; onChange: (a: Action) => void }) {
  const project = useProjectStore((s) => s.project);
  const [advanced, setAdvanced] = useState(false);
  const domain = value.entityId ? entityDomain(value.entityId) : '';
  const services = useMemo(
    () => (value.entityId ? servicesForDomain(domain, entityCapabilities(project, value.entityId)) : []),
    [project, domain, value.entityId],
  );
  const info = services.find((s) => s.service === value.service);
  const fieldKeys = new Set(info?.fields.map((f) => f.key) ?? []);
  const extraKeys = Object.keys(value.data ?? {}).filter((k) => !fieldKeys.has(k));
  const custom = value.service !== '' && !info;
  const showAdvanced = advanced || custom || (services.length === 0 && value.entityId !== '');

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <EntityPicker
          label="Entidad"
          value={value.entityId}
          onChange={(entityId) => {
            const nextDomain = entityDomain(entityId);
            const keep = value.service && value.service.split('.')[0] === nextDomain;
            const first = servicesForDomain(nextDomain, entityCapabilities(project, entityId))[0]?.service ?? '';
            onChange({ ...value, entityId, service: keep ? value.service : first });
          }}
        />
        {showAdvanced ? (
          <ServiceTextField value={value.service} services={services.map((s) => s.service)} onChange={(service) => onChange({ ...value, service })} />
        ) : (
          <SelectField
            label="Servicio"
            value={value.service}
            placeholder={services.length === 0 ? '— Elige antes una entidad —' : '— Elige un servicio —'}
            disabled={services.length === 0}
            options={services.map((s) => ({ value: s.service, label: `${s.name} (${s.service})` }))}
            onChange={(e) => {
              const next = services.find((s) => s.service === e.target.value);
              const keys = new Set(next?.fields.map((f) => f.key) ?? []);
              const data = Object.fromEntries(Object.entries(value.data ?? {}).filter(([k]) => keys.has(k)));
              onChange({ ...value, service: e.target.value, data: Object.keys(data).length > 0 ? data : undefined });
            }}
          />
        )}
      </div>
      {showAdvanced ? (
        <DataField value={value.data} onChange={(data) => onChange({ ...value, data })} />
      ) : (
        info && <ServiceDataFields fields={info.fields} value={value.data} onChange={(data) => onChange({ ...value, data })} />
      )}
      {!showAdvanced && extraKeys.length > 0 && (
        <p className="text-xs text-amber-800">Otros datos: {extraKeys.join(', ')} (edítalos en modo avanzado)</p>
      )}
      {!custom && services.length > 0 && (
        <label className="flex items-center gap-1.5 self-start text-xs text-slate-600">
          <input
            type="checkbox"
            checked={advanced}
            onChange={(e) => setAdvanced(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
          />
          Avanzado (texto libre)
        </label>
      )}
    </div>
  );
}

function ServiceTextField({ value, services, onChange }: { value: string; services: string[]; onChange: (s: string) => void }) {
  const listId = useId();
  return (
    <Field label="Servicio">
      {(id) => (
        <>
          <input id={id} list={listId} className={inputClass} value={value} placeholder="light.turn_on" onChange={(e) => onChange(e.target.value)} />
          <datalist id={listId}>
            {services.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </>
      )}
    </Field>
  );
}

export function ActionEditor({ value, onChange }: { value: Action; onChange: (a: Action) => void }) {
  const scenes = useProjectStore((s) => s.project.scenes);
  const scripts = useProjectStore((s) => s.project.scripts);
  const header = <div className="mb-1 text-xs font-semibold text-slate-700">{ACTION_LABELS[value.type]}</div>;

  switch (value.type) {
    case 'service':
      return (
        <div>
          {header}
          <ServiceActionEditor value={value} onChange={onChange} />
        </div>
      );
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
