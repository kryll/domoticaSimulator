import { useEffect, useState } from 'react';
import { countLabel } from '../ui/plural';
import type { Project } from '../types';
import { openAsNewProject } from '../store/bootstrap';
import { useUiStore } from '../store/uiStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { decodeProjectFromHash } from './share';

type State = { kind: 'loading' } | { kind: 'ready'; project: Project } | { kind: 'error'; message: string } | { kind: 'closed' };

/** Quita #p=... de la barra de direcciones sin recargar. */
function clearHash() {
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    window.location.hash = '';
  }
}

/** Al abrir la app con #p=... ofrece abrir el proyecto compartido como un proyecto nuevo (B20). */
export function SharedLinkPrompt() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    decodeProjectFromHash(window.location.hash)
      .then((project) => {
        if (!cancelled) setState({ kind: 'ready', project });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const close = () => {
    clearHash();
    setState({ kind: 'closed' });
  };

  if (state.kind === 'loading' || state.kind === 'closed') return null;

  if (state.kind === 'error') {
    return (
      <Modal open title="Enlace compartido no válido" onClose={close} footer={<Button onClick={close}>Cerrar</Button>}>
        <p role="alert" className="text-sm text-red-800">
          {state.message}
        </p>
      </Modal>
    );
  }

  const { project } = state;
  const open = async () => {
    try {
      // Siempre con id nuevo: nunca sobrescribe un proyecto guardado.
      const opened = await openAsNewProject({ ...project, id: crypto.randomUUID(), name: project.name });
      useUiStore.getState().notify(`Proyecto compartido «${opened.name}» abierto como proyecto nuevo`, 'success');
    } catch (err) {
      useUiStore.getState().notify(`No se pudo abrir el proyecto: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
    close();
  };

  return (
    <Modal
      open
      title="Proyecto compartido"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Ignorar
          </Button>
          <Button variant="primary" onClick={() => void open()}>
            Abrir como proyecto nuevo
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm text-slate-700">
        <p>
          El enlace contiene el proyecto <strong>«{project.name}»</strong>. Se abrirá como un proyecto nuevo; el actual queda guardado tal cual.
        </p>
        <ul className="grid grid-cols-2 gap-1 text-xs text-slate-600">
          <li>{countLabel(project.floors.length, 'planta', 'plantas')}</li>
          <li>{countLabel(project.rooms.length, 'sala', 'salas')}</li>
          <li>{countLabel(project.devices.length, 'dispositivo', 'dispositivos')}</li>
          <li>{countLabel(project.automations.length, 'automatización', 'automatizaciones')}</li>
        </ul>
      </div>
    </Modal>
  );
}
