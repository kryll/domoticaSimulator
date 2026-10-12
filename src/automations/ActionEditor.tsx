import { useId, useMemo, useRef, useState } from 'react';
import type { Action, ServiceTargets } from '../types';
import { useProjectStore } from '../store/projectStore';
import { EntityPicker } from './EntityPicker';
import { ACTION_LABELS, actionFactories } from '../ui/automationOptions';
import { ListEditor } from './ListEditor';
import { AdvancedActionEditor } from './advanced/AdvancedActionEditor';
import { ScopeItem, VariableHelp } from './advanced/VariableHelp';
import { insertAt } from './advanced/scopeVars';
import { Field, SelectField, TextField, inputClass } from '../ui/Field';
import { dataToInput, parseDataInput, parseNumberInput } from '../ui/formValues';
import { servicesForDomain } from '../simulation/serviceCatalog';
import { entityCapabilities } from '../devices/capabilities';
import { entityDomain } from '../devices/entities';
import { ServiceDataFields } from './ServiceDataFields';
import { isNotifyService, notifyAction } from '../simulation/notify';
import { withRequiredDefaults } from '../ui/serviceFields';
import { StepShell } from './tanda3/StepFlags';
import { ParallelActionEditor, StopActionEditor } from './tanda3/Tanda3Editors';

type ActionData = Extract<Action, { type: 'service' }>['data'];

function sameData(a: ActionData, b: ActionData): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

/** Campo «Datos» controlado: borrador local que se resincroniza si value cambia desde fuera. */
function DataField({ value, onChange }: { value: ActionData; onChange: (data: ActionData) => void }) {
  const [draft, setDraft] = useState(() => dataToInput(value));
  const [seen, setSeen] = useState(value);
  const caret = useRef<[number | null, number | null]>([null, null]);
  if (seen !== value) {
    setSeen(value);
    if (!sameData(parseDataInput(draft), value)) setDraft(dataToInput(value));
  }
  const apply = (text: string) => {
    setDraft(text);
    const parsed = parseDataInput(text);
    if (!sameData(parsed, value)) onChange(parsed);
  };
  return (
    <div className="flex flex-col gap-1">
      <TextField
        label="Datos (clave=valor)"
        placeholder="brightness=200"
        value={draft}
        onSelect={(e) => {
          caret.current = [e.currentTarget.selectionStart, e.currentTarget.selectionEnd];
        }}
        onChange={(e) => apply(e.target.value)}
      />
      <VariableHelp
        onInsert={(token) => {
          const r = insertAt(draft, token, caret.current[0], caret.current[1]);
          caret.current = [r.caret, r.caret];
          apply(r.text);
        }}
      />
    </div>
  );
}

type ServiceAction = Extract<Action, { type: 'service' }>;

function withTargets(value: ServiceAction, targets: ServiceTargets): ServiceAction {
  const clean: ServiceTargets = {};
  if (targets.entityIds && targets.entityIds.length > 0) clean.entityIds = targets.entityIds;
  if (targets.areaIds && targets.areaIds.length > 0) clean.areaIds = targets.areaIds;
  const next = { ...value };
  if (Object.keys(clean).length === 0) delete next.targets;
  else next.targets = clean;
  return next;
}

function Chip({ label, onRemove, removeLabel }: { label: string; onRemove: () => void; removeLabel: string }) {
  return (
    <li className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 py-0.5 pl-2 pr-1 text-xs text-slate-700">
      <span className="max-w-[14rem] truncate" title={label}>
        {label}
      </span>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="rounded-full px-1 text-slate-500 hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        ✕
      </button>
    </li>
  );
}

/** Destinos adicionales: más entidades del mismo dominio (chips) y salas/áreas (`area_id`). */
function ExtraTargets({ value, domain, onChange }: { value: ServiceAction; domain: string; onChange: (a: ServiceAction) => void }) {
  const rooms = useProjectStore((s) => s.project.rooms);
  const floors = useProjectStore((s) => s.project.floors);
  const entityIds = value.targets?.entityIds ?? [];
  const areaIds = value.targets?.areaIds ?? [];
  const floorName = new Map(floors.map((f) => [f.id, f.name]));
  const roomLabel = (id: string) => {
    const room = rooms.find((r) => r.id === id);
    return room ? `${room.name}${floors.length > 1 ? ` (${floorName.get(room.floorId) ?? '?'})` : ''}` : `${id} (no existe)`;
  };
  const excluded = new Set([value.entityId, ...entityIds]);
  const freeRooms = rooms.filter((r) => !areaIds.includes(r.id));
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-slate-300 p-2">
      {entityIds.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Más entidades de destino">
          {entityIds.map((id) => (
            <Chip
              key={id}
              label={id}
              removeLabel={`Quitar ${id}`}
              onRemove={() => onChange(withTargets(value, { entityIds: entityIds.filter((x) => x !== id), areaIds }))}
            />
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {domain !== '' && (
          <EntityPicker
            label="Añadir entidad"
            value=""
            domains={[domain]}
            hint={`Más entidades «${domain}» con el mismo servicio`}
            onChange={(id) => {
              if (!id || excluded.has(id)) return;
              if (value.entityId === '') onChange({ ...value, entityId: id });
              else onChange(withTargets(value, { entityIds: [...entityIds, id], areaIds }));
            }}
          />
        )}
        <SelectField
          label="Sala/área"
          value=""
          placeholder={freeRooms.length === 0 ? '— No hay más salas —' : '— Añadir una sala —'}
          disabled={freeRooms.length === 0}
          options={freeRooms.map((r) => ({ value: r.id, label: roomLabel(r.id) }))}
          onChange={(e) => {
            if (e.target.value) onChange(withTargets(value, { entityIds, areaIds: [...areaIds, e.target.value] }));
          }}
        />
      </div>
      {areaIds.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Salas de destino">
          {areaIds.map((id) => (
            <Chip
              key={id}
              label={`🏠 ${roomLabel(id)}`}
              removeLabel={`Quitar la sala ${roomLabel(id)}`}
              onRemove={() => onChange(withTargets(value, { entityIds, areaIds: areaIds.filter((x) => x !== id) }))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Entidad, servicio (filtrado por el dominio) y datos tipados, con modo «Avanzado» de texto libre. */
function ServiceActionEditor({ value, onChange }: { value: ServiceAction; onChange: (a: Action) => void }) {
  const project = useProjectStore((s) => s.project);
  const [advanced, setAdvanced] = useState(false);
  // Las notificaciones no tienen entidad de destino (entityId vacío).
  const notify = isNotifyService(value.service);
  // Sin entidad principal, el dominio sale de la primera entidad adicional o del servicio (solo áreas).
  const firstEntity = value.entityId || value.targets?.entityIds?.[0] || '';
  const domain = notify ? 'notify' : firstEntity ? entityDomain(firstEntity) : value.service.includes('.') ? (value.service.split('.')[0] ?? '') : '';
  const services = useMemo(
    () =>
      notify
        ? servicesForDomain('notify')
        : firstEntity
          ? servicesForDomain(domain, entityCapabilities(project, firstEntity))
          : domain
            ? servicesForDomain(domain)
            : [],
    [project, domain, firstEntity, notify],
  );
  const info = services.find((s) => s.service === value.service);
  const fieldKeys = new Set(info?.fields.map((f) => f.key) ?? []);
  const extraKeys = Object.keys(value.data ?? {}).filter((k) => !fieldKeys.has(k));
  const custom = value.service !== '' && !info;
  const showAdvanced = advanced || custom || (services.length === 0 && (value.entityId !== '' || value.targets !== undefined));

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {notify ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-slate-600">Destino</span>
            <span className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-sm text-slate-700">
              🔔 Notificación de Home Assistant (sin entidad)
              <button
                type="button"
                className="ml-auto text-xs text-sky-700 hover:underline"
                onClick={() => onChange({ type: 'service', service: '', entityId: '' })}
              >
                Usar una entidad
              </button>
            </span>
          </div>
        ) : (
        <EntityPicker
          label="Entidad"
          value={value.entityId}
          onChange={(entityId) => {
            const nextDomain = entityDomain(entityId);
            const keep = value.service && value.service.split('.')[0] === nextDomain;
            const first = servicesForDomain(nextDomain, entityCapabilities(project, entityId))[0];
            // Las entidades adicionales deben ser del mismo dominio: se descartan si cambia.
            const extra = (value.targets?.entityIds ?? []).filter((id) => entityDomain(id) === nextDomain && id !== entityId);
            const base = withTargets(value, { entityIds: extra, areaIds: value.targets?.areaIds ?? [] });
            if (keep) onChange({ ...base, entityId });
            else onChange({ ...base, entityId, service: first?.service ?? '', data: withRequiredDefaults(first?.fields ?? [], undefined) });
          }}
        />
        )}
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
              const kept = Object.fromEntries(Object.entries(value.data ?? {}).filter(([k]) => keys.has(k)));
              const data = withRequiredDefaults(next?.fields ?? [], Object.keys(kept).length > 0 ? kept : undefined);
              onChange({ ...value, service: e.target.value, data });
            }}
          />
        )}
      </div>
      {!notify && <ExtraTargets value={value} domain={domain} onChange={onChange} />}
      {showAdvanced ? (
        <DataField value={value.data} onChange={(data) => onChange({ ...value, data })} />
      ) : (
        info && <ServiceDataFields fields={info.fields} value={value.data} onChange={(data) => onChange({ ...value, data })} />
      )}
      {!showAdvanced && extraKeys.length > 0 && (
        <p className="text-xs text-amber-800">Otros datos: {extraKeys.join(', ')} (edítalos en modo avanzado)</p>
      )}
      {!notify && value.entityId === '' && value.targets === undefined && (
        <button type="button" className="self-start text-xs text-sky-700 hover:underline" onClick={() => onChange(notifyAction(''))}>
          🔔 Enviar una notificación en su lugar
        </button>
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

function ActionFields({ value, onChange }: { value: Action; onChange: (a: Action) => void }) {
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
    case 'stop':
      return <StopActionEditor value={value} onChange={onChange} />;
    case 'parallel':
      return <ParallelActionEditor value={value} onChange={onChange} />;
    default:
      return <AdvancedActionEditor value={value} onChange={onChange} />;
  }
}

/** Acción con sus interruptores «Activado» y «Seguir si falla». */
export function ActionEditor({ value, onChange }: { value: Action; onChange: (a: Action) => void }) {
  return (
    <StepShell value={value} onChange={onChange} kind="acción">
      <ActionFields value={value} onChange={onChange} />
    </StepShell>
  );
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
      renderItem={(a, update, i) => (
        <ScopeItem actions={actions} index={i}>
          <ActionEditor value={a} onChange={update} />
        </ScopeItem>
      )}
      addOptions={actionFactories}
      emptyText="Sin acciones."
    />
  );
}
