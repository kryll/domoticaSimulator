import { useCallback, useEffect, useState } from 'react';
import type { Id } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { deleteVersion, listVersions, loadVersion, saveVersion, type VersionMeta } from '../store/versions';
import { diffProjects } from '../store/versionDiff';
import { Badge } from './Badge';
import { Button } from './Button';
import { TextField } from './Field';
import { Modal } from './Modal';
import { EmptyState } from './Panel';
import { confirmDialog } from './confirm';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
}

interface Comparison {
  versionId: Id;
  lines: string[];
}

/** Archivo → «Historial de versiones…»: copias automáticas y manuales del proyecto. */
export function VersionsDialog() {
  const projectId = useProjectStore((s) => s.project.id);
  const close = useCallback(() => useUiStore.getState().setVersionsOpen(false), []);
  const notify = useUiStore((s) => s.notify);
  const [items, setItems] = useState<VersionMeta[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [comparison, setComparison] = useState<Comparison | null>(null);

  const refresh = useCallback(() => {
    listVersions(projectId)
      .then(setItems)
      .catch((err: unknown) => {
        setItems([]);
        notify(`No se pudo leer el historial: ${errorText(err)}`, 'error');
      });
  }, [projectId, notify]);
  useEffect(refresh, [refresh]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveNowVersion = () =>
    guard(async () => {
      const text = label.trim();
      await saveVersion(useProjectStore.getState().project, { auto: false, ...(text ? { label: text } : {}) });
      setLabel('');
      notify(text ? `Versión «${text}» guardada` : 'Versión guardada', 'success');
      refresh();
    });

  const compare = (v: VersionMeta) =>
    guard(async () => {
      const old = await loadVersion(v.id);
      if (!old) throw new Error('No se encontró la versión');
      const diff = diffProjects(old, useProjectStore.getState().project);
      setComparison({ versionId: v.id, lines: diff.identical ? ['Sin diferencias con el proyecto actual.'] : diff.summary });
    });

  const restore = (v: VersionMeta) =>
    guard(async () => {
      const old = await loadVersion(v.id);
      if (!old) throw new Error('No se encontró la versión');
      const current = useProjectStore.getState().project;
      // Antes de restaurar se guarda una copia automática de lo actual.
      await saveVersion(current, { auto: true, label: 'Antes de restaurar' });
      useProjectStore.getState().replaceProject({ ...old, id: current.id });
      notify(`Versión del ${formatDate(v.createdAt)} restaurada`, 'success', {
        action: { label: 'Deshacer', run: () => useProjectStore.getState().undo() },
      });
      close();
    });

  const remove = (v: VersionMeta) =>
    guard(async () => {
      const ok = await confirmDialog({
        title: '¿Borrar esta versión?',
        message: `${v.label ?? (v.auto ? 'Copia automática' : 'Versión')} del ${formatDate(v.createdAt)}. No se puede deshacer.`,
        confirmLabel: 'Borrar',
        danger: true,
      });
      if (!ok) return;
      await deleteVersion(v.id);
      if (comparison?.versionId === v.id) setComparison(null);
      refresh();
    });

  return (
    <Modal open title="Historial de versiones" onClose={close} size="lg">
      <div className="flex flex-col gap-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveNowVersion();
          }}
        >
          <div className="min-w-[12rem] flex-1">
            <TextField label="Etiqueta (opcional)" placeholder="p. ej. Antes de rehacer la planta alta" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button type="submit" variant="primary" disabled={busy}>
            Guardar versión ahora
          </Button>
        </form>
        <p className="text-xs text-slate-500">
          Se guarda una copia automática al abrir el proyecto y cada 10 minutos de edición. Las automáticas antiguas se borran solas; las guardadas a mano se conservan.
        </p>
        {items === null ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : items.length === 0 ? (
          <EmptyState>Todavía no hay versiones guardadas.</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100" aria-label="Versiones">
            {items.map((v) => (
              <li key={v.id} className="flex flex-col gap-1 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
                      <time dateTime={v.createdAt}>{formatDate(v.createdAt)}</time>
                      <Badge tone={v.auto ? 'slate' : 'green'}>{v.auto ? 'Automática' : 'Manual'}</Badge>
                      {v.label && <span className="truncate text-slate-700">{v.label}</span>}
                    </div>
                    <div className="text-xs text-slate-500">{v.summary}</div>
                  </div>
                  <Button size="sm" disabled={busy} onClick={() => void compare(v)} aria-label={`Comparar con la actual la versión del ${formatDate(v.createdAt)}`}>
                    Comparar con la actual
                  </Button>
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => void restore(v)} aria-label={`Restaurar la versión del ${formatDate(v.createdAt)}`}>
                    Restaurar
                  </Button>
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(v)} aria-label={`Borrar la versión del ${formatDate(v.createdAt)}`}>
                    Borrar
                  </Button>
                </div>
                {comparison?.versionId === v.id && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700" role="region" aria-label="Diferencias con la actual">
                    <p className="mb-1 font-medium">De esta versión a la actual:</p>
                    <ul className="list-disc pl-4">
                      {comparison.lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
