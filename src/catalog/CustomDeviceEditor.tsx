import { useMemo, useState, type ReactNode } from 'react';
import type { Brand, DeviceCategory, DeviceDefinition, EntityCapabilities, EntityDefinition, EntityDomain, Integration, IotClass, NetworkRole, PowerSource, Protocol } from '../types';
import {
  BRANDS,
  CATEGORIES,
  CATEGORY_LABELS,
  ENTITY_DOMAINS,
  INTEGRATIONS,
  INTEGRATION_IOT_CLASS,
  INTEGRATION_LABELS,
  IOT_CLASSES,
  IOT_CLASS_LABELS,
  POWER_LABELS,
  POWER_SOURCES,
  PROTOCOLS,
  PROTOCOL_LABELS,
  ROLES,
  ROLE_LABELS,
} from '../devices/labels';
import { catalog, cloneDefinition, getDefinition, validateDefinition } from '../devices/catalog';
import { useProjectStore } from '../store/projectStore';
import { useLayoutStore, type CustomDeviceEditorState } from '../store/layoutStore';
import { useUiStore } from '../store/uiStore';
import { knownDefinitions } from '../canvas/analysis';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { SelectField, TextAreaField, TextField } from '../ui/Field';
import { parseNumberInput } from '../ui/formValues';
import { DOMAIN_INITIAL, blankDefinition, blankEntity, customIdFor, parseInitialState, saveCustomDefinition } from './customDevices';

function initialDraft(state: CustomDeviceEditorState): { def: DeviceDefinition; replaceId?: string } {
  if (state.mode === 'new') return { def: blankDefinition() };
  const source = getDefinition(state.definitionId, knownDefinitions());
  if (!source) return { def: blankDefinition() };
  if (state.mode === 'edit') return { def: JSON.parse(JSON.stringify(source)) as DeviceDefinition, replaceId: source.id };
  return { def: cloneDefinition(source) };
}

function Checks<T extends string>({ legend, values, selected, labels, onChange }: { legend: string; values: readonly T[]; selected: T[]; labels: Record<T, string>; onChange: (v: T[]) => void }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-medium text-slate-600">{legend}</legend>
      <div className="flex max-h-32 flex-wrap gap-x-3 gap-y-1 overflow-auto rounded-md border border-slate-200 p-2">
        {values.map((v) => (
          <label key={v} className="flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={selected.includes(v)}
              onChange={(e) => onChange(e.target.checked ? [...selected, v] : selected.filter((x) => x !== v))}
              className="h-4 w-4 rounded border-slate-300 text-sky-600"
            />
            {labels[v]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Capacidades de una entidad como JSON (colorModes, hvacModes, alarmModes...). */
function CapabilitiesField({ value, onChange }: { value: EntityCapabilities | undefined; onChange: (c: EntityCapabilities | undefined, valid: boolean) => void }) {
  const [draft, setDraft] = useState(() => (value ? JSON.stringify(value) : ''));
  const [error, setError] = useState<string | null>(null);
  return (
    <TextAreaField
      label="Capacidades (JSON, opcional)"
      rows={2}
      placeholder='{"colorModes": ["brightness"]}'
      value={draft}
      aria-invalid={error !== null}
      hint={error ?? undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        const t = e.target.value.trim();
        if (t === '') {
          setError(null);
          onChange(undefined, true);
          return;
        }
        try {
          const parsed: unknown = JSON.parse(t);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Debe ser un objeto');
          setError(null);
          onChange(parsed as EntityCapabilities, true);
        } catch {
          setError('JSON no válido');
          onChange(value, false);
        }
      }}
    />
  );
}

function EntityRow({ entity, index, onChange, onRemove, onCapsValid }: { entity: EntityDefinition; index: number; onChange: (e: EntityDefinition) => void; onRemove: () => void; onCapsValid: (ok: boolean) => void }) {
  const [stateText, setStateText] = useState(String(entity.initialState));
  return (
    <li className="rounded-md border border-slate-200 bg-slate-50 p-2" aria-label={`Entidad ${index + 1}`}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <TextField label="Clave" value={entity.key} onChange={(e) => onChange({ ...entity, key: e.target.value.trim() })} />
        <TextField label="Nombre de la entidad" value={entity.name} onChange={(e) => onChange({ ...entity, name: e.target.value })} />
        <SelectField
          label="Dominio"
          value={entity.domain}
          options={ENTITY_DOMAINS.map((d) => ({ value: d, label: d }))}
          onChange={(e) => {
            const domain = e.target.value as EntityDomain;
            const initialState = DOMAIN_INITIAL[domain] ?? entity.initialState;
            setStateText(String(initialState));
            onChange({ ...entity, domain, initialState });
          }}
        />
        <TextField
          label="device_class"
          value={entity.deviceClass ?? ''}
          placeholder="temperature, motion…"
          onChange={(e) => onChange({ ...entity, deviceClass: e.target.value.trim() || undefined })}
        />
        <TextField label="Unidad" value={entity.unit ?? ''} placeholder="°C, %, W…" onChange={(e) => onChange({ ...entity, unit: e.target.value.trim() || undefined })} />
        <TextField
          label="Estado inicial"
          value={stateText}
          onChange={(e) => {
            setStateText(e.target.value);
            onChange({ ...entity, initialState: parseInitialState(e.target.value) });
          }}
        />
      </div>
      <div className="mt-2 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <CapabilitiesField
            value={entity.capabilities}
            onChange={(capabilities, ok) => {
              onCapsValid(ok);
              if (ok) onChange({ ...entity, capabilities });
            }}
          />
        </div>
        <Button size="sm" variant="danger" onClick={onRemove} aria-label={`Quitar entidad ${index + 1}`}>
          Quitar
        </Button>
      </div>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

let entityKeySeq = 0;

/**
 * Editor de dispositivos personalizados: nuevo, «Clonar y editar» de uno del catálogo o edición de
 * uno propio. Se valida con validateDefinition y se guarda en el proyecto (con Deshacer).
 */
export function CustomDeviceEditor() {
  const state = useLayoutStore((s) => s.customDevice);
  const close = () => useLayoutStore.getState().openCustomDevice(null);
  const [{ def: start, replaceId }] = useState(() => initialDraft(state ?? { mode: 'new' }));
  const [def, setDef] = useState<DeviceDefinition>(start);
  const [keys, setKeys] = useState<number[]>(() => start.entities.map(() => ++entityKeySeq));
  const [capsInvalid, setCapsInvalid] = useState<Record<number, boolean>>({});
  const [touched, setTouched] = useState(false);

  // El id se deriva de marca y modelo (al editar se conserva el suyo).
  const finalDef = useMemo<DeviceDefinition>(() => {
    const project = useProjectStore.getState().project;
    const id = replaceId ?? customIdFor({ ...def, id: '' }, project);
    const clean: DeviceDefinition = { ...def, id, name: def.name.trim() || `${def.brand} ${def.model}`.trim() };
    if (clean.priceEur === undefined) delete clean.priceEur;
    return clean;
  }, [def, replaceId]);
  const errors = useMemo(() => {
    const list = validateDefinition(finalDef, catalog);
    if (!def.model.trim()) list.unshift('Indica el modelo');
    if (Object.values(capsInvalid).some(Boolean)) list.push('Hay capacidades con JSON no válido');
    return list;
  }, [finalDef, def.model, capsInvalid]);

  if (!state) return null;
  const set = <K extends keyof DeviceDefinition>(key: K, value: DeviceDefinition[K]) => setDef((d) => ({ ...d, [key]: value }));
  const title = state.mode === 'edit' ? `Editar «${start.name}»` : state.mode === 'clone' ? 'Clonar y editar dispositivo' : 'Dispositivo personalizado';

  const save = () => {
    setTouched(true);
    if (errors.length > 0) return;
    useProjectStore.getState().update((p) => saveCustomDefinition(p, finalDef, replaceId));
    useUiStore.getState().notify(`«${finalDef.name}» guardado en el catálogo del proyecto`, 'success', {
      action: { label: 'Deshacer', run: () => useProjectStore.getState().undo() },
    });
    close();
  };

  return (
    <Modal
      open
      size="lg"
      title={title}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={touched && errors.length > 0}>
            Guardar dispositivo
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Section title="Identificación">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <SelectField label="Marca" value={def.brand} options={BRANDS.map((b) => ({ value: b, label: b }))} onChange={(e) => set('brand', e.target.value as Brand)} />
            <TextField label="Modelo" value={def.model} onChange={(e) => set('model', e.target.value)} />
            <TextField label="Nombre" value={def.name} placeholder={`${def.brand} ${def.model}`.trim()} onChange={(e) => set('name', e.target.value)} />
            <SelectField
              label="Categoría"
              value={def.category}
              options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
              onChange={(e) => set('category', e.target.value as DeviceCategory)}
            />
            <TextField
              label="Precio (€)"
              type="number"
              min={0}
              value={def.priceEur ?? ''}
              onChange={(e) => set('priceEur', parseNumberInput(e.target.value))}
            />
            <p className="self-end pb-1 text-xs text-slate-600">
              Id: <code>{finalDef.id}</code>
            </p>
          </div>
        </Section>
        <Section title="Red e integración">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Checks<Protocol> legend="Protocolos" values={PROTOCOLS} selected={def.protocols} labels={PROTOCOL_LABELS} onChange={(v) => set('protocols', v)} />
            <Checks<Integration>
              legend="Integraciones"
              values={INTEGRATIONS}
              selected={def.integrations}
              labels={INTEGRATION_LABELS}
              onChange={(v) => {
                set('integrations', v);
                // La primera integración sugiere la clase IoT (local o nube).
                const first = v[0];
                if (first && v.length === 1) set('iotClass', INTEGRATION_IOT_CLASS[first]);
              }}
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <SelectField label="Clase IoT" value={def.iotClass} options={IOT_CLASSES.map((c) => ({ value: c, label: IOT_CLASS_LABELS[c] }))} onChange={(e) => set('iotClass', e.target.value as IotClass)} />
            <SelectField label="Rol en la red" value={def.role} options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} onChange={(e) => set('role', e.target.value as NetworkRole)} />
            <SelectField label="Alimentación" value={def.power} options={POWER_SOURCES.map((p) => ({ value: p, label: POWER_LABELS[p] }))} onChange={(e) => set('power', e.target.value as PowerSource)} />
          </div>
        </Section>
        <Section title="Entidades">
          <ol className="flex flex-col gap-2">
            {def.entities.map((entity, i) => (
              <EntityRow
                key={keys[i] ?? i}
                entity={entity}
                index={i}
                onChange={(next) => set('entities', def.entities.map((e, j) => (j === i ? next : e)))}
                onRemove={() => {
                  set('entities', def.entities.filter((_, j) => j !== i));
                  setKeys((k) => k.filter((_, j) => j !== i));
                }}
                onCapsValid={(ok) => setCapsInvalid((c) => ({ ...c, [keys[i] ?? i]: !ok }))}
              />
            ))}
          </ol>
          <Button
            size="sm"
            className="self-start"
            onClick={() => {
              set('entities', [...def.entities, blankEntity(def.entities.length)]);
              setKeys((k) => [...k, ++entityKeySeq]);
            }}
          >
            + Añadir entidad
          </Button>
        </Section>
        {touched && errors.length > 0 && (
          <ul role="alert" className="list-disc rounded-md border border-red-200 bg-red-50 py-2 pl-6 pr-2 text-sm text-red-800">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </form>
    </Modal>
  );
}
