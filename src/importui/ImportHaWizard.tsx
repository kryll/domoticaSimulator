import { useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { applyImportPlan, type ImportInput, type ImportPlan } from '../import/haImport';
import { knownDefinitions } from '../canvas/analysis';
import { useProjectStore } from '../store/projectStore';
import { useLayoutStore } from '../store/layoutStore';
import { useUiStore } from '../store/uiStore';
import { createEmptyProject, deleteProject } from '../store/persistence';
import { openAsNewProject, openProject } from '../store/bootstrap';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { cx } from '../ui/cx';
import { readFileAsText } from '../ui/download';
import { countLabel } from '../ui/plural';
import {
  HA_FILE_LABELS,
  HA_FILE_ORDER,
  detectHaFile,
  originalModels,
  planFor,
  type HaFileKind,
  type MatchOverride,
} from './importFiles';

type Step = 'files' | 'review' | 'target';
const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'files', label: 'Ficheros' },
  { key: 'review', label: 'Revisar' },
  { key: 'target', label: 'Destino' },
];

interface Loaded {
  kind: HaFileKind;
  name: string;
  content: string;
}

function Stepper({ step }: { step: Step }) {
  const index = STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="mb-3 flex flex-wrap gap-2 text-xs" aria-label="Pasos">
      {STEPS.map((s, i) => (
        <li
          key={s.key}
          aria-current={s.key === step ? 'step' : undefined}
          className={cx('rounded-full px-2.5 py-1 font-semibold', i === index ? 'bg-sky-700 text-white' : i < index ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600')}
        >
          {i + 1}. {s.label}
        </li>
      ))}
    </ol>
  );
}

function FilesStep({ files, onFiles, onRemove, errors }: { files: Loaded[]; onFiles: (list: FileList | File[]) => void; onRemove: (kind: HaFileKind) => void; errors: string[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const hintId = useId();
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length > 0) onFiles(e.dataTransfer.files);
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-700">
        Sube los ficheros de tu Home Assistant: <code>automations.yaml</code>, <code>scenes.yaml</code>, <code>scripts.yaml</code> y, de la carpeta{' '}
        <code>.storage</code>, <code>core.device_registry</code>, <code>core.area_registry</code> y <code>core.entity_registry</code>. Puedes subir solo algunos.
      </p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cx('flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center', over ? 'border-sky-500 bg-sky-50' : 'border-slate-300 bg-slate-50')}
      >
        <p className="text-sm text-slate-700" id={hintId}>
          Arrastra aquí los ficheros
        </p>
        <Button onClick={() => inputRef.current?.click()} aria-describedby={hintId}>
          Elegir ficheros…
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Ficheros de Home Assistant"
          onChange={(e) => {
            if (e.target.files) onFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {errors.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-red-700">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <ul aria-label="Ficheros cargados" className="flex flex-col gap-1">
        {HA_FILE_ORDER.map((kind) => {
          const f = files.find((x) => x.kind === kind);
          return (
            <li key={kind} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1 text-sm">
              <span className={f ? 'text-slate-800' : 'text-slate-500'}>
                <span aria-hidden="true">{f ? '✅' : '◻️'}</span> {HA_FILE_LABELS[kind]}
                {f && f.name !== HA_FILE_LABELS[kind] && <span className="text-xs text-slate-500"> ({f.name})</span>}
              </span>
              {f && (
                <Button size="sm" variant="ghost" aria-label={`Quitar ${HA_FILE_LABELS[kind]}`} onClick={() => onRemove(kind)}>
                  ✕
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ReviewStep({
  plan,
  overrides,
  setOverride,
  originals,
  existingRooms,
}: {
  plan: ImportPlan;
  overrides: Record<string, MatchOverride>;
  setOverride: (haId: string, o: MatchOverride | null) => void;
  originals: Map<string, { manufacturer?: string; model?: string }>;
  existingRooms: Set<string>;
}) {
  const defs = useMemo(() => [...knownDefinitions()].sort((a, b) => `${a.brand} ${a.name}`.localeCompare(`${b.brand} ${b.name}`, 'es')), []);
  const roomName = new Map(plan.rooms.map((r) => [r.id, r.name]));
  const autoWarnings = (i: number) => plan.warnings.filter((w) => w.path.startsWith(`automations.yaml[${i}]`));
  const otherWarnings = plan.warnings.filter((w) => !/^automations\.yaml\[\d+\]/.test(w.path));
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="imp-areas">
        <h3 id="imp-areas" className="mb-1 text-sm font-semibold text-slate-800">
          Áreas → salas ({plan.rooms.length})
        </h3>
        {plan.rooms.length === 0 ? (
          <p className="text-sm text-slate-600">No hay áreas nuevas{existingRooms.size > 0 ? ' (se usarán las salas existentes con el mismo nombre)' : ''}.</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {plan.rooms.map((r) => (
              <li key={r.id}>
                <Badge tone="slate">🏠 {r.name}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="imp-devices">
        <h3 id="imp-devices" className="mb-1 text-sm font-semibold text-slate-800">
          Dispositivos ({plan.matches.length})
        </h3>
        {plan.matches.length === 0 ? (
          <p className="text-sm text-slate-600">Sin registro de dispositivos.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {plan.matches.map((m) => {
              const orig = originals.get(m.haDeviceId) ?? {};
              const o = overrides[m.haDeviceId];
              const value = o?.kind === 'custom' ? '__custom__' : o?.kind === 'definition' ? o.definitionId : m.custom ? '__custom__' : m.definitionId;
              const selectId = `imp-${m.haDeviceId}`;
              return (
                <li key={m.haDeviceId} className="grid grid-cols-1 gap-1 rounded-md border border-slate-200 p-2 sm:grid-cols-[1fr,16rem] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{m.name}</p>
                    <p className="truncate text-xs text-slate-600">
                      {[orig.manufacturer, orig.model].filter(Boolean).join(' · ') || 'Sin fabricante ni modelo'}
                      {m.roomId && ` · ${roomName.get(m.roomId) ?? 'sala existente'}`}
                    </p>
                    <span className="mt-0.5 inline-block">
                      {m.custom ? (
                        <Badge tone="amber">Personalizado</Badge>
                      ) : o ? (
                        <Badge tone="violet">Corregido</Badge>
                      ) : (
                        <Badge tone={m.score >= 0.99 ? 'green' : 'amber'}>{m.score >= 0.99 ? 'Coincidencia exacta' : `Parecido ${Math.round(m.score * 100)} %`}</Badge>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label htmlFor={selectId} className="text-xs font-medium text-slate-600">
                      Equivale a
                    </label>
                    <select
                      id={selectId}
                      value={value}
                      className="w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '__custom__') setOverride(m.haDeviceId, { kind: 'custom' });
                        else setOverride(m.haDeviceId, { kind: 'definition', definitionId: v });
                      }}
                    >
                      <option value="__custom__">Crear personalizado</option>
                      {defs.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.brand} · {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section aria-labelledby="imp-autos">
        <h3 id="imp-autos" className="mb-1 text-sm font-semibold text-slate-800">
          Automatizaciones ({plan.automations.length}) · escenas ({plan.scenes.length}) · scripts ({plan.scripts.length})
        </h3>
        <ul className="flex flex-col gap-1">
          {plan.automations.map((a, i) => {
            const ws = autoWarnings(i);
            return (
              <li key={a.id} className="rounded-md border border-slate-200 px-2 py-1 text-sm">
                <span className="font-medium text-slate-800">{a.name}</span>{' '}
                {ws.length > 0 ? <Badge tone="amber">{countLabel(ws.length, 'aviso', 'avisos')}</Badge> : <Badge tone="green">Sin avisos</Badge>}
                {ws.length > 0 && (
                  <ul className="mt-1 list-disc pl-5 text-xs text-amber-900">
                    {ws.map((w, j) => (
                      <li key={j}>{w.message}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>
      {(otherWarnings.length > 0 || plan.unknownEntities.length > 0) && (
        <details className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
          <summary className="cursor-pointer font-medium">
            Otros avisos ({otherWarnings.length + (plan.unknownEntities.length > 0 ? 1 : 0)})
          </summary>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {otherWarnings.map((w, i) => (
              <li key={i}>
                <strong>{w.path}</strong>: {w.message}
              </li>
            ))}
            {plan.unknownEntities.length > 0 && <li>Entidades sin resolver: {plan.unknownEntities.join(', ')}</li>}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Asistente «Importar desde Home Assistant…» (Archivo). */
export function ImportHaWizard() {
  const close = () => useLayoutStore.getState().setImportHaOpen(false);
  const [step, setStep] = useState<Step>('files');
  const [files, setFiles] = useState<Loaded[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [overrides, setOverrides] = useState<Record<string, MatchOverride>>({});
  const [target, setTarget] = useState<'merge' | 'new'>('merge');
  const [busy, setBusy] = useState(false);
  const current = useProjectStore((s) => s.project);

  const input = useMemo<ImportInput>(() => Object.fromEntries(files.map((f) => [f.kind, f.content])) as ImportInput, [files]);
  const originals = useMemo(() => originalModels(input.deviceRegistry), [input]);
  const plan = useMemo(() => (step === 'files' ? null : planFor(current, input, overrides)), [step, current, input, overrides]);

  const addFiles = async (list: FileList | File[]) => {
    const errs: string[] = [];
    const loaded: Loaded[] = [];
    for (const file of Array.from(list)) {
      try {
        const content = await readFileAsText(file);
        const kind = detectHaFile(file.name, content);
        if (kind) loaded.push({ kind, name: file.name, content });
        else errs.push(`«${file.name}» no parece un fichero de Home Assistant`);
      } catch {
        errs.push(`No se pudo leer «${file.name}»`);
      }
    }
    setErrors(errs);
    setFiles((prev) => [...prev.filter((p) => !loaded.some((l) => l.kind === p.kind)), ...loaded]);
  };

  const apply = async () => {
    setBusy(true);
    const ui = useUiStore.getState();
    try {
      if (target === 'merge') {
        const project = useProjectStore.getState().project;
        const finalPlan = planFor(project, input, overrides);
        useProjectStore.getState().update((p) => applyImportPlan(p, finalPlan));
        ui.notify(`Importado desde Home Assistant: ${countLabel(finalPlan.devices.length, 'dispositivo', 'dispositivos')} y ${countLabel(finalPlan.automations.length, 'automatización', 'automatizaciones')}`, 'success', {
          action: { label: 'Deshacer', run: () => useProjectStore.getState().undo() },
        });
      } else {
        const previous = useProjectStore.getState().project;
        const empty = createEmptyProject('Importado de Home Assistant');
        const finalPlan = planFor(empty, input, overrides);
        const opened = await openAsNewProject(applyImportPlan(empty, finalPlan));
        ui.notify(`Proyecto «${opened.name}» creado con ${countLabel(finalPlan.devices.length, 'dispositivo', 'dispositivos')}`, 'success', {
          action: {
            label: 'Deshacer',
            run: () => {
              openProject(previous);
              void deleteProject(opened.id).catch(() => undefined);
            },
          },
        });
      }
      close();
    } catch (err) {
      ui.notify(`No se pudo importar: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const canNext = files.length > 0;
  const footer = (
    <>
      <Button onClick={close}>Cancelar</Button>
      {step !== 'files' && <Button onClick={() => setStep(step === 'target' ? 'review' : 'files')}>Atrás</Button>}
      {step === 'files' && (
        <Button variant="primary" disabled={!canNext} onClick={() => setStep('review')}>
          Siguiente
        </Button>
      )}
      {step === 'review' && (
        <Button variant="primary" onClick={() => setStep('target')}>
          Siguiente
        </Button>
      )}
      {step === 'target' && (
        <Button variant="primary" disabled={busy} onClick={() => void apply()}>
          Importar
        </Button>
      )}
    </>
  );

  return (
    <Modal open size="lg" title="Importar desde Home Assistant" onClose={close} footer={footer}>
      <Stepper step={step} />
      {step === 'files' && <FilesStep files={files} onFiles={(l) => void addFiles(l)} onRemove={(k) => setFiles((f) => f.filter((x) => x.kind !== k))} errors={errors} />}
      {step === 'review' && plan && (
        <ReviewStep
          plan={plan}
          overrides={overrides}
          originals={originals}
          existingRooms={new Set(current.rooms.map((r) => r.name))}
          setOverride={(id, o) =>
            setOverrides((prev) => {
              const next = { ...prev };
              if (o) next[id] = o;
              else delete next[id];
              return next;
            })
          }
        />
      )}
      {step === 'target' && plan && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-slate-800">¿Dónde se importa?</legend>
          <label className="flex items-start gap-2 rounded-md border border-slate-200 p-2 text-sm">
            <input type="radio" name="ha-target" checked={target === 'merge'} onChange={() => setTarget('merge')} className="mt-0.5 h-4 w-4" />
            <span>
              <strong>Fusionar con el proyecto actual</strong> («{current.name}»)
              <span className="block text-xs text-slate-600">Se añaden salas, dispositivos y lógica. Se deshace con Ctrl+Z.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md border border-slate-200 p-2 text-sm">
            <input type="radio" name="ha-target" checked={target === 'new'} onChange={() => setTarget('new')} className="mt-0.5 h-4 w-4" />
            <span>
              <strong>En un proyecto nuevo</strong>
              <span className="block text-xs text-slate-600">El actual queda guardado; «Deshacer» vuelve a él.</span>
            </span>
          </label>
          <p className="text-sm text-slate-700">
            Se importarán {countLabel(plan.rooms.length, 'sala', 'salas')}, {countLabel(plan.devices.length, 'dispositivo', 'dispositivos')} (
            {countLabel(plan.customDefinitions.length, 'personalizado', 'personalizados')}), {countLabel(plan.automations.length, 'automatización', 'automatizaciones')},{' '}
            {countLabel(plan.scenes.length, 'escena', 'escenas')} y {countLabel(plan.scripts.length, 'script', 'scripts')}.
          </p>
        </fieldset>
      )}
    </Modal>
  );
}
