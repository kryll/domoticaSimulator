import { useEffect, useId, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { saveNow } from '../store/autosave';
import { loadLatestVersion, overwriteWithMine, saveMineAsCopy } from '../store/conflict';
import { exportProjectJson } from '../store/persistence';
import { useUiStore } from '../store/uiStore';
import { Button } from './Button';
import { cx } from './cx';
import { downloadText, safeFilename } from './download';
import { trapTab } from './focusTrap';

function downloadCopy() {
  const project = useProjectStore.getState().project;
  downloadText(exportProjectJson(project), `${safeFilename(project.name)}.json`, 'application/json');
}

/** Indicador compacto del guardado, visible a todos los anchos: ✓ Guardado, ● Guardando…, ⚠ Error. */
export function SaveIndicator() {
  const status = useProjectStore((s) => s.saveStatus);
  const dirty = useProjectStore((s) => s.dirty);
  const error = useProjectStore((s) => s.saveError);
  const saving = status === 'saving' || (status === 'saved' && dirty);
  if (status === 'error') {
    return (
      <button
        type="button"
        onClick={() => void saveNow()}
        title={`Error al guardar${error ? `: ${error}` : ''}. Pulsa para reintentar.`}
        className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <span aria-hidden="true">⚠</span>
        <span className="hidden sm:inline">Error al guardar</span>
        <span className="sr-only sm:hidden">Error al guardar.</span>
        <span className="sr-only"> Reintentar</span>
      </button>
    );
  }
  return (
    <span
      role="status"
      aria-live="polite"
      title={saving ? 'Guardando…' : 'Guardado en este navegador'}
      className={cx('flex shrink-0 items-center gap-1 text-[11px]', saving ? 'text-amber-700' : 'text-emerald-700')}
    >
      <span aria-hidden="true">{saving ? '●' : '✓'}</span>
      <span className="hidden sm:inline">{saving ? 'Guardando…' : 'Guardado'}</span>
      <span className="sr-only sm:hidden">{saving ? 'Guardando…' : 'Guardado'}</span>
    </span>
  );
}

/** Aviso persistente cuando falla el guardado: Reintentar o descargar una copia JSON. */
export function SaveErrorBanner() {
  const status = useProjectStore((s) => s.saveStatus);
  const error = useProjectStore((s) => s.saveError);
  const [retrying, setRetrying] = useState(false);
  if (status !== 'error') return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-800">
      <span aria-hidden="true">⚠</span>
      <span className="min-w-0 flex-1">
        No se ha podido guardar el proyecto en el navegador{error ? ` (${error})` : ''}. Tus cambios siguen aquí: reintenta o descarga una copia.
      </span>
      <Button
        size="sm"
        disabled={retrying}
        onClick={() => {
          setRetrying(true);
          void saveNow().finally(() => setRetrying(false));
        }}
      >
        Reintentar
      </Button>
      <Button size="sm" onClick={downloadCopy}>
        Descargar copia JSON
      </Button>
    </div>
  );
}

/** Diálogo propio de conflicto entre pestañas. */
export function SaveConflictDialog() {
  const conflict = useProjectStore((s) => s.conflict);
  const titleId = useId();
  const descId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const open = conflict !== null;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!conflict) return null;

  const run = (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    fn()
      .then(() => useUiStore.getState().notify(done, 'success'))
      .catch((err: unknown) => useUiStore.getState().notify(err instanceof Error ? err.message : String(err), 'error'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center bg-slate-900/40 p-4">
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onKeyDown={(e) => trapTab(e, ref.current)}
      >
        <div className="px-4 pb-2 pt-4">
          <h2 id={titleId} className="text-base font-semibold text-slate-800">
            Este proyecto se ha modificado en otra pestaña
          </h2>
          <p id={descId} className="mt-1 text-sm text-slate-600">
            Otra pestaña ha guardado una versión más reciente. El guardado automático de esta pestaña está en pausa hasta que elijas qué hacer.
          </p>
        </div>
        <div className="flex flex-col gap-2 border-t border-slate-200 px-4 py-3">
          <Button ref={firstRef} variant="primary" disabled={busy} onClick={() => run(async () => {
                if (!(await loadLatestVersion())) throw new Error('No se encontró la versión guardada');
              }, 'Se ha cargado la versión más reciente')}>
            Cargar la versión más reciente
          </Button>
          <Button disabled={busy} onClick={() => run(overwriteWithMine, 'Se ha guardado tu versión')}>
            Mantener la mía y sobrescribir
          </Button>
          <Button disabled={busy} onClick={() => run(async () => {
                if (!(await saveMineAsCopy())) throw new Error('No se pudo guardar la copia');
              }, 'Tu versión se ha guardado como copia')}>
            Guardar la mía como copia
          </Button>
        </div>
      </div>
    </div>
  );
}
