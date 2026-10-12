import { useId, useState } from 'react';
import type { Helper, HelperType } from '../types';
import { useProjectStore } from '../store/projectStore';
import { updateWithRename } from '../store/entityRename';
import { HELPER_TYPES, HELPER_TYPE_LABELS, formatTimerDuration, helperEntityId, parseTimerDuration, validateHelper } from '../simulation/helpers';
import { Button } from '../ui/Button';
import { SelectField, TextAreaField, TextField } from '../ui/Field';
import { newId } from '../ui/ids';
import { parseNumberInput } from '../ui/formValues';
import { confirmDialog } from '../ui/confirm';
import { useUiStore } from '../store/uiStore';
import { HELPER_ICONS, defaultHelper, helperRenameMapping, helperUsage, removeHelper, saveHelper } from './helperModel';
import { HelperControl } from './HelperControl';

const EMPTY: Helper[] = [];

/** Número con borrador propio (se puede vaciar y reescribir sin que salte un valor por defecto). */
function NumberInput({ label, value, onChange, optional = false }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; optional?: boolean }) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  return (
    <TextField
      label={label}
      type="number"
      value={draft}
      placeholder={optional ? 'Sin límite' : undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(parseNumberInput(e.target.value));
      }}
    />
  );
}

function OptionsInput({ options, onChange }: { options: string[]; onChange: (o: string[]) => void }) {
  const [draft, setDraft] = useState(options.join('\n'));
  return (
    <TextAreaField
      label="Opciones (una por línea)"
      rows={3}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value.split('\n').map((o) => o.trim()).filter((o) => o !== ''));
      }}
    />
  );
}

/** Campos propios de cada tipo de helper. */
function TypeFields({ value, onChange }: { value: Helper; onChange: (h: Helper) => void }) {
  switch (value.type) {
    case 'input_boolean':
      return (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={value.initial === true} onChange={(e) => onChange({ ...value, initial: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-sky-600" />
          Empieza encendido
        </label>
      );
    case 'input_number':
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <NumberInput label="Mínimo" value={value.min} onChange={(v) => onChange({ ...value, min: v ?? 0 })} />
          <NumberInput label="Máximo" value={value.max} onChange={(v) => onChange({ ...value, max: v ?? 0 })} />
          <NumberInput label="Paso" value={value.step} onChange={(v) => onChange({ ...value, step: v ?? 1 })} />
          <TextField label="Unidad" value={value.unit ?? ''} onChange={(e) => onChange({ ...value, unit: e.target.value || undefined })} />
          <SelectField
            label="Modo"
            value={value.mode}
            options={[
              { value: 'slider', label: 'Deslizador' },
              { value: 'box', label: 'Casilla' },
            ]}
            onChange={(e) => onChange({ ...value, mode: e.target.value as 'slider' | 'box' })}
          />
          <NumberInput label="Valor inicial" optional value={value.initial} onChange={(v) => onChange({ ...value, initial: v })} />
        </div>
      );
    case 'input_select':
      return (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <OptionsInput options={value.options} onChange={(options) => onChange({ ...value, options, ...(value.initial !== undefined && !options.includes(value.initial) ? { initial: undefined } : {}) })} />
          <SelectField
            label="Opción inicial"
            value={value.initial ?? ''}
            placeholder="La primera"
            options={value.options.map((o) => ({ value: o, label: o }))}
            onChange={(e) => onChange({ ...value, initial: e.target.value || undefined })}
          />
        </div>
      );
    case 'input_text':
      return (
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="Longitud máxima" value={value.max} onChange={(v) => onChange({ ...value, max: v })} />
          <TextField label="Texto inicial" value={value.initial ?? ''} onChange={(e) => onChange({ ...value, initial: e.target.value || undefined })} />
        </div>
      );
    case 'input_datetime':
      return (
        <div className="flex flex-wrap gap-4 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={value.has_date} onChange={(e) => onChange({ ...value, has_date: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-sky-600" />
            Con fecha
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={value.has_time} onChange={(e) => onChange({ ...value, has_time: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-sky-600" />
            Con hora
          </label>
        </div>
      );
    case 'timer':
      return <DurationInput seconds={value.duration} onChange={(duration) => onChange({ ...value, duration })} />;
    case 'counter':
      return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <NumberInput label="Inicial" value={value.initial} onChange={(v) => onChange({ ...value, initial: v ?? 0 })} />
          <NumberInput label="Paso" value={value.step} onChange={(v) => onChange({ ...value, step: v ?? 1 })} />
          <NumberInput label="Mínimo" optional value={value.minimum} onChange={(v) => onChange({ ...value, minimum: v })} />
          <NumberInput label="Máximo" optional value={value.maximum} onChange={(v) => onChange({ ...value, maximum: v })} />
        </div>
      );
  }
}

function DurationInput({ seconds, onChange }: { seconds: number; onChange: (s: number) => void }) {
  const [draft, setDraft] = useState(() => formatTimerDuration(seconds));
  const parsed = parseTimerDuration(draft);
  return (
    <TextField
      label="Duración (h:mm:ss)"
      value={draft}
      aria-invalid={parsed === undefined}
      hint={parsed === undefined ? 'Formato h:mm:ss, mm:ss o segundos' : undefined}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = parseTimerDuration(e.target.value);
        if (v !== undefined) onChange(v);
      }}
    />
  );
}

function HelperForm({ initial, onDone }: { initial: Helper; onDone: () => void }) {
  const [draft, setDraft] = useState<Helper>(initial);
  const isNew = !(useProjectStore.getState().project.helpers ?? []).some((h) => h.id === initial.id);
  const errors = validateHelper(draft);
  const errorId = useId();
  const save = () => {
    if (errors.length > 0) return;
    const project = useProjectStore.getState().project;
    const mapping = helperRenameMapping(project, draft);
    updateWithRename(mapping, (p) => saveHelper(p, draft));
    onDone();
  };
  return (
    <form
      aria-label={isNew ? `Nuevo helper: ${HELPER_TYPE_LABELS[draft.type]}` : `Editar ${initial.name}`}
      className="flex flex-col gap-2 rounded-md border border-sky-200 bg-sky-50/50 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <TextField label="Nombre" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
        <p className="self-end pb-1 text-xs text-slate-600">
          Entidad: <code>{helperEntityId(draft)}</code>
        </p>
      </div>
      <TypeFields value={draft} onChange={setDraft} />
      {errors.length > 0 && (
        <ul id={errorId} role="alert" className="list-disc pl-5 text-xs text-red-700">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={errors.length > 0} aria-describedby={errors.length > 0 ? errorId : undefined}>
          Guardar
        </Button>
        <Button size="sm" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/**
 * Ayudantes de HA (input_boolean, input_number, input_select, input_text, input_datetime, timer
 * y counter): alta y edición con un formulario por tipo, y sus controles para la simulación.
 */
export function HelpersSection() {
  const helpers = useProjectStore((s) => s.project.helpers ?? EMPTY);
  const [editing, setEditing] = useState<Helper | null>(null);
  const [newType, setNewType] = useState<HelperType>('input_boolean');

  const remove = async (h: Helper) => {
    const project = useProjectStore.getState().project;
    const used = helperUsage(project, helperEntityId(h));
    const ok = await confirmDialog({
      title: `¿Eliminar «${h.name}»?`,
      message: used.length > 0 ? `Lo usa: ${used.join(', ')}. Esas referencias quedarán rotas.` : 'Puedes deshacerlo con Ctrl+Z.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    useProjectStore.getState().update((p) => removeHelper(p, h.id));
    useUiStore.getState().notify(`Helper «${h.name}» eliminado`, 'info', { action: { label: 'Deshacer', run: () => useProjectStore.getState().undo() } });
  };

  return (
    <section aria-labelledby="helpers-title" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="helpers-title" className="text-sm font-semibold text-slate-800">
            Ayudantes (helpers)
          </h3>
          <p className="text-xs text-slate-600">Interruptores, números, listas, textos, fechas, temporizadores y contadores para tus automatizaciones.</p>
        </div>
        <div className="flex items-end gap-1">
          <SelectField
            label="Tipo"
            value={newType}
            options={HELPER_TYPES.map((t) => ({ value: t, label: `${HELPER_ICONS[t]} ${HELPER_TYPE_LABELS[t]}` }))}
            onChange={(e) => setNewType(e.target.value as HelperType)}
          />
          <Button size="sm" variant="primary" onClick={() => setEditing(defaultHelper(newType, newId('helper')))}>
            + Añadir helper
          </Button>
        </div>
      </div>
      {editing && !helpers.some((h) => h.id === editing.id) && <HelperForm key={editing.id} initial={editing} onDone={() => setEditing(null)} />}
      {helpers.length === 0 && !editing && <p className="rounded-md border border-dashed border-slate-300 p-3 text-center text-sm text-slate-600">Todavía no hay helpers.</p>}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-2" aria-label="Helpers">
        {helpers.map((h) => {
          const entityId = helperEntityId(h);
          return (
            <li key={h.id} className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-2">
              {editing?.id === h.id ? (
                <HelperForm key={h.id} initial={h} onDone={() => setEditing(null)} />
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        <span aria-hidden="true">{HELPER_ICONS[h.type]}</span> {h.name}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">
                        {HELPER_TYPE_LABELS[h.type]} · <code>{entityId}</code>
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="ghost" aria-label={`Editar ${h.name}`} onClick={() => setEditing(h)}>
                        ✎
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Eliminar ${h.name}`} onClick={() => void remove(h)}>
                        ✕
                      </Button>
                    </div>
                  </div>
                  <HelperControl helper={h} entityId={entityId} />
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
