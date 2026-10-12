import { useId, useMemo, useState } from 'react';
import type { Project } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import {
  AUTOMATION_TEMPLATES,
  buildTemplate,
  defaultTemplateValues,
  isTemplateApplicable,
  missingTemplateInputs,
  suggestTemplates,
  templateCandidates,
  type AutomationTemplate,
  type TemplateInput,
  type TemplateValues,
} from './templates';
import { entitiesOfDevice, knownDefinitions } from '../canvas/analysis';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { TextField } from '../ui/Field';
import { EntityPicker } from './EntityPicker';
import { DurationField } from './DurationField';

interface Choice {
  template: AutomationTemplate;
  values: TemplateValues;
  reason?: string;
  /** Si no se puede usar en este proyecto, por qué. */
  blocked?: string;
}

/** Motivo por el que una plantilla no se puede aplicar (undefined si se puede). */
function blockedReason(template: AutomationTemplate, project: Project): string | undefined {
  if (isTemplateApplicable(template, project, knownDefinitions())) return undefined;
  const lacking = template.inputs.filter(
    (i) => i.kind === 'entity' && !i.optional && templateCandidates(project, knownDefinitions(), i).length === 0,
  );
  if (lacking.length > 0) return `Falta en el proyecto: ${lacking.map((i) => `«${i.label}»`).join(', ')}`;
  return 'Los dispositivos del proyecto no encajan con esta plantilla';
}

/** Plantillas aplicables a un dispositivo, con su entidad ya elegida en la primera entrada compatible. */
function choicesForDevice(project: Project, deviceId: string): Choice[] {
  const device = project.devices.find((d) => d.id === deviceId);
  if (!device) return [];
  const own = new Set(entitiesOfDevice(device).map((r) => r.entityId));
  const out: Choice[] = [];
  for (const template of AUTOMATION_TEMPLATES) {
    const values = defaultTemplateValues(template);
    let used = false;
    for (const input of template.inputs) {
      if (input.kind !== 'entity' || used) continue;
      const match = templateCandidates(project, knownDefinitions(), input).find((id) => own.has(id));
      if (match) {
        values[input.key] = match;
        used = true;
      }
    }
    if (!used) continue;
    const blocked = blockedReason(template, project);
    out.push({ template, values, reason: `Con ${device.name}`, ...(blocked ? { blocked } : {}) });
  }
  return out;
}

function InputField({
  input,
  value,
  onChange,
  project,
}: {
  input: TemplateInput;
  value: string | number | undefined;
  onChange: (v: string | number) => void;
  project: Project;
}) {
  switch (input.kind) {
    case 'entity': {
      const allowed = templateCandidates(project, knownDefinitions(), input);
      return (
        <EntityPicker
          label={input.optional ? `${input.label} (opcional)` : input.label}
          value={String(value ?? '')}
          onChange={onChange}
          domains={input.domains}
          deviceClasses={input.deviceClass}
          allowedIds={allowed}
          optional={input.optional === true}
          hint={allowed.length === 0 ? 'No hay ninguna entidad compatible en el proyecto.' : input.hint}
        />
      );
    }
    case 'duration':
      return (
        <DurationField
          label={`${input.label} (min:s)`}
          value={typeof value === 'number' ? value : Number(value) || undefined}
          onChange={(sec) => onChange(sec ?? 0)}
        />
      );
    case 'time':
      return <TextField label={input.label} type="time" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} hint={input.hint} />;
    case 'number':
      return (
        <TextField
          label={input.unit ? `${input.label} (${input.unit})` : input.label}
          type="number"
          min={input.min}
          max={input.max}
          step="any"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          hint={input.hint}
        />
      );
    case 'percent': {
      const n = typeof value === 'number' ? value : Number(value) || 0;
      return (
        <TextField
          label={`${input.label}: ${n} %`}
          type="range"
          min={input.min ?? 0}
          max={input.max ?? 100}
          step={1}
          value={n}
          onChange={(e) => onChange(Number(e.target.value))}
          hint={input.hint}
          className="px-0"
        />
      );
    }
  }
}

function TemplateForm({ choice, onBack, onDone }: { choice: Choice; onBack: () => void; onDone: () => void }) {
  const project = useProjectStore((s) => s.project);
  const [values, setValues] = useState<TemplateValues>(choice.values);
  const missing = missingTemplateInputs(choice.template, values, project);

  const create = () => {
    if (missing.length > 0) return;
    const store = useProjectStore.getState();
    const built = buildTemplate(choice.template, values, store.project);
    const created = built.map((a) => store.addAutomation(a));
    const first = created[0];
    const ui = useUiStore.getState();
    if (first) ui.showAutomation(first.id, 'visual');
    ui.notify(
      created.length === 1 ? `Automatización «${first?.name ?? ''}» creada` : `${created.length} automatizaciones creadas desde la plantilla`,
      'success',
    );
    onDone();
  };

  return (
    <form
      className="flex flex-col gap-3"
      aria-label={`Plantilla ${choice.template.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        create();
      }}
    >
      <p className="text-sm text-slate-600">{choice.template.description}</p>
      {choice.template.inputs.map((input) => (
        <InputField
          key={input.key}
          input={input}
          project={project}
          value={values[input.key]}
          onChange={(v) => setValues((prev) => ({ ...prev, [input.key]: v }))}
        />
      ))}
      {missing.length > 0 && (
        <ul className="text-xs text-amber-800" aria-live="polite">
          {missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <div className="flex justify-between gap-2 border-t border-slate-200 pt-3">
        <Button onClick={onBack}>← Volver</Button>
        <Button type="submit" variant="primary" disabled={missing.length > 0}>
          Crear automatización
        </Button>
      </div>
    </form>
  );
}

function TemplateCard({ choice, onPick }: { choice: Choice; onPick: () => void }) {
  const reasonId = useId();
  const blocked = choice.blocked !== undefined;
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        disabled={blocked}
        aria-describedby={blocked ? reasonId : undefined}
        className="flex h-full w-full flex-col gap-0.5 rounded-md border border-slate-200 p-2 text-left hover:border-sky-400 hover:bg-sky-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70 disabled:hover:border-slate-200"
      >
        <span className="text-sm font-semibold text-slate-800">{choice.template.name}</span>
        <span className="text-xs text-slate-600">{choice.template.description}</span>
        {choice.reason && !blocked && <span className="text-[11px] font-medium text-emerald-700">✨ {choice.reason}</span>}
        {blocked && (
          <span id={reasonId} className="text-[11px] font-medium text-amber-800">
            ⚠ {choice.blocked}
          </span>
        )}
      </button>
    </li>
  );
}

/** Galería «Desde plantilla»: sugeridas primero, formulario con las entradas y creación. */
export function TemplateGallery() {
  const gallery = useUiStore((s) => s.templateGallery);
  const project = useProjectStore((s) => s.project);
  const close = () => useUiStore.getState().openTemplates(null);
  const [selected, setSelected] = useState<Choice | null>(null);
  const deviceId = gallery?.deviceId;
  const deviceName = deviceId ? project.devices.find((d) => d.id === deviceId)?.name : undefined;

  const { suggested, others } = useMemo(() => {
    if (deviceId) return { suggested: choicesForDevice(project, deviceId), others: [] as Choice[] };
    const suggestions = suggestTemplates(project, knownDefinitions());
    const sug: Choice[] = [];
    for (const s of suggestions) {
      const template = AUTOMATION_TEMPLATES.find((t) => t.id === s.templateId);
      if (template) sug.push({ template, values: s.values, reason: s.reason });
    }
    const ids = new Set(sug.map((c) => c.template.id));
    const rest = AUTOMATION_TEMPLATES.filter((t) => !ids.has(t.id))
      .map((template): Choice => {
        const blocked = blockedReason(template, project);
        return { template, values: defaultTemplateValues(template), ...(blocked ? { blocked } : {}) };
      })
      .sort((a, b) => Number(a.blocked !== undefined) - Number(b.blocked !== undefined));
    return { suggested: sug, others: rest };
    // Se calcula al abrir: no hace falta seguir los cambios del proyecto con el diálogo abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const title = selected ? selected.template.name : deviceName ? `Plantillas con ${deviceName}` : 'Crear desde plantilla';

  return (
    <Modal open title={title} onClose={close} size="lg">
      {selected ? (
        <TemplateForm choice={selected} onBack={() => setSelected(null)} onDone={close} />
      ) : (
        <div className="flex flex-col gap-4">
          <section aria-label={deviceName ? `Plantillas con ${deviceName}` : 'Sugeridas para tu proyecto'}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {deviceName ? `Plantillas que usan ${deviceName}` : 'Sugeridas para tu proyecto'}
            </h3>
            {suggested.length === 0 ? (
              <p className="text-xs text-slate-500">
                {deviceName ? 'Ninguna plantilla usa este dispositivo.' : 'Añade dispositivos para recibir sugerencias.'}
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {suggested.map((c) => (
                  <TemplateCard key={c.template.id} choice={c} onPick={() => setSelected(c)} />
                ))}
              </ul>
            )}
          </section>
          {others.length > 0 && (
            <section aria-label="Otras plantillas">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Otras plantillas</h3>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {others.map((c) => (
                  <TemplateCard key={c.template.id} choice={c} onPick={() => setSelected(c)} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
