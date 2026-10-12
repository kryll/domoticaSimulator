import { useEffect, useMemo } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useViewStore } from '../store/viewStore';
import { catalog } from '../devices/catalog';
import { addCatalogDevice } from '../canvas/placeDevice';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { focusCatalogSearch } from './focusCatalog';
import { GUIDE_STEPS, defaultServerDefinition, guideProgress, isEmptyProject, type GuideStep } from './guide';

function runStep(step: GuideStep) {
  const ui = useUiStore.getState();
  if (step === 'room') {
    ui.setCanvasMode('room');
    ui.notify('Arrastra en el lienzo para dibujar la sala. Esc cancela.', 'info');
  } else if (step === 'server') {
    const def = defaultServerDefinition(catalog);
    if (def) addCatalogDevice(def.id);
  } else if (!focusCatalogSearch()) {
    ui.notify('Abre el catálogo (en pantallas más anchas está a la izquierda) para añadir dispositivos.', 'info');
  }
}

/**
 * Estado vacío guiado sobre el lienzo: tres pasos marcables con un botón que inicia cada acción.
 * En un proyecto vacío se muestra centrado; cuando ya hay algo, sigue como tarjeta compacta hasta
 * completar los pasos o cerrarla.
 */
export function EmptyCanvasGuide() {
  const project = useProjectStore((s) => s.project);
  const guideProjectId = useViewStore((s) => s.guideProjectId);
  const dismissed = useViewStore((s) => s.guideDismissed);
  const manual = useViewStore((s) => s.guideManual);
  const mode = useUiStore((s) => s.canvasMode);
  const empty = isEmptyProject(project);
  const progress = useMemo(() => guideProgress(project, catalog), [project]);

  useEffect(() => {
    if (empty && dismissed !== project.id) useViewStore.getState().startGuide(project.id);
  }, [empty, project.id, dismissed]);

  const done = (k: GuideStep) => progress[k] || manual[k] === true;
  const allDone = GUIDE_STEPS.every((s) => done(s.key));
  const visible = dismissed !== project.id && (empty || (guideProjectId === project.id && !allDone));
  if (!visible || mode === 'room' || mode === 'wall') return null;

  const completed = GUIDE_STEPS.filter((s) => done(s.key)).length;
  return (
    <div
      className={cx(
        'pointer-events-none absolute z-[5] flex',
        empty ? 'inset-0 items-center justify-center p-4' : 'right-3 top-14 max-w-xs',
      )}
      data-export-ignore=""
    >
      <section
        aria-labelledby="guide-title"
        className={cx('pointer-events-auto rounded-xl border border-slate-200 bg-white/95 shadow-lg', empty ? 'w-full max-w-md p-5' : 'p-3')}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 id="guide-title" className={cx('font-semibold text-slate-900', empty ? 'text-lg' : 'text-sm')}>
              {empty ? 'Empieza tu instalación' : 'Primeros pasos'}
            </h2>
            <p className="text-xs text-slate-600" aria-live="polite">
              {completed} de {GUIDE_STEPS.length} pasos hechos
            </p>
          </div>
          {!empty && (
            <Button size="sm" variant="ghost" aria-label="Ocultar la guía" onClick={() => useViewStore.getState().dismissGuide(project.id)}>
              ✕
            </Button>
          )}
        </div>
        <ol className="mt-3 flex flex-col gap-2">
          {GUIDE_STEPS.map((step, i) => {
            const checked = done(step.key);
            return (
              <li key={step.key} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id={`guide-${step.key}`}
                  checked={checked}
                  onChange={() => useViewStore.getState().toggleGuideStep(step.key)}
                  disabled={progress[step.key]}
                  className="mt-1 h-4 w-4 rounded border-slate-400 text-sky-700 focus:ring-sky-600"
                />
                <div className="min-w-0 flex-1">
                  <label htmlFor={`guide-${step.key}`} className={cx('block text-sm font-medium', checked ? 'text-slate-500 line-through' : 'text-slate-900')}>
                    {i + 1}. {step.title}
                  </label>
                  {empty && <p className="text-xs text-slate-600">{step.hint}</p>}
                </div>
                {!checked && (
                  <Button size="sm" variant={completed === i ? 'primary' : 'secondary'} onClick={() => runStep(step.key)}>
                    {step.action}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
