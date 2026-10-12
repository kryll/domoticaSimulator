import { useState } from 'react';
import { useRecoveryStore } from '../store/recoveryStore';
import { openAsNewProject } from '../store/bootstrap';
import { listVersions, loadVersion } from '../store/versions';
import { repairProject } from '../store/repair';
import { useUiStore } from '../store/uiStore';
import { Modal } from './Modal';
import { Button } from './Button';
import { downloadText, safeFilename } from './download';
import type { Project } from '../types';

/** Última copia del historial que se puede leer (de la más reciente a la más antigua). */
async function lastValidVersion(projectId: string): Promise<Project | undefined> {
  for (const meta of await listVersions(projectId)) {
    try {
      const project = await loadVersion(meta.id);
      if (project) return project;
    } catch {
      // copia dañada: se prueba la anterior
    }
  }
  return undefined;
}

/**
 * Aviso de proyecto ilegible al arrancar. Lo guardado no se toca nunca: se puede abrir la última
 * versión válida del historial, intentar repararlo (descartando lo no válido) o descargar el JSON
 * tal cual. Lo recuperado se abre como un proyecto nuevo, junto al ilegible.
 */
export function RecoverProjectDialog() {
  const unreadable = useRecoveryStore((s) => s.unreadable);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!unreadable) return null;
  const close = () => useRecoveryStore.getState().setUnreadable(null);
  const notify = useUiStore.getState().notify;

  const openVersion = async () => {
    setBusy(true);
    try {
      const version = await lastValidVersion(unreadable.id);
      if (!version) {
        setMessage('No hay ninguna versión válida en el historial de este proyecto. Prueba a repararlo o descarga el JSON.');
        return;
      }
      await openAsNewProject({ ...version, name: `${unreadable.name} (recuperado)` });
      notify(`Abierta la última versión válida de «${unreadable.name}» como proyecto nuevo`, 'success');
      close();
    } finally {
      setBusy(false);
    }
  };

  const repair = async () => {
    setBusy(true);
    try {
      const { project, notes } = repairProject(unreadable.raw);
      await openAsNewProject({ ...project, name: `${unreadable.name} (reparado)` });
      notify(
        notes.length === 0 ? 'Proyecto reparado y abierto como proyecto nuevo' : `Proyecto reparado y abierto como nuevo. ${notes.slice(0, 3).join('. ')}${notes.length > 3 ? '…' : ''}`,
        'success',
      );
      close();
    } catch (err) {
      setMessage(`No se ha podido reparar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    let text: string;
    try {
      text = JSON.stringify(unreadable.raw, null, 2) ?? 'null';
    } catch {
      text = String(unreadable.raw);
    }
    downloadText(text, `${safeFilename(unreadable.name)}-sin-reparar.json`, 'application/json');
  };

  return (
    <Modal
      open
      size="lg"
      title="No se puede abrir el proyecto"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Seguir con la demo</Button>
          <Button onClick={download}>Descargar el JSON en bruto</Button>
          <Button onClick={() => void repair()} disabled={busy}>
            Intentar reparar
          </Button>
          <Button variant="primary" onClick={() => void openVersion()} disabled={busy}>
            Abrir la última versión válida
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm text-slate-700">
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-900">
          El proyecto «{unreadable.name}» está dañado y no se puede leer: {unreadable.error}
        </p>
        <p>
          No se ha modificado: sigue guardado tal cual en este navegador. Mientras decides, se ha abierto un proyecto de demo provisional. Lo que
          recuperes se abre como un proyecto nuevo, sin sobrescribir el dañado.
        </p>
        {message && (
          <p role="status" className="rounded-md bg-amber-50 px-2 py-1 text-amber-900">
            {message}
          </p>
        )}
      </div>
    </Modal>
  );
}
