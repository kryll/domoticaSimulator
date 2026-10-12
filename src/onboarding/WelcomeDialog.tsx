import { useProjectStore } from '../store/projectStore';
import { createEmptyProject, deleteProject } from '../store/persistence';
import { openAsNewProject } from '../store/bootstrap';
import { markWelcomeDone, tourDone, useViewStore } from '../store/viewStore';
import { useUiStore } from '../store/uiStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

function finish() {
  markWelcomeDone();
  const view = useViewStore.getState();
  view.setWelcomeOpen(false);
  if (!tourDone()) view.startTour();
}

/** Primera visita: abrir la demo (ya cargada y guardada) o empezar con un proyecto en blanco. */
export function WelcomeDialog() {
  const open = useViewStore((s) => s.welcomeOpen);
  if (!open) return null;

  const blank = async () => {
    const demoId = useProjectStore.getState().project.id;
    const unchanged = useProjectStore.getState().past.length === 0;
    try {
      await openAsNewProject(createEmptyProject('Mi instalación'));
      // La demo recién abierta y sin tocar no se queda en la lista de proyectos.
      if (unchanged) await deleteProject(demoId).catch(() => undefined);
    } catch (err) {
      useUiStore.getState().notify(`No se pudo crear el proyecto: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
    finish();
  };

  return (
    <Modal
      open
      title="Bienvenido a HA Simulator"
      onClose={finish}
      footer={
        <>
          <Button onClick={() => void blank()}>Empezar en blanco</Button>
          <Button variant="primary" onClick={finish}>
            Explorar la demo
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm text-slate-700">
        <p>Diseña y simula una instalación domótica con Home Assistant: plano, dispositivos reales, red, automatizaciones y presupuesto.</p>
        <ul className="list-disc pl-5">
          <li>
            <strong>Explorar la demo</strong>: una casa de ejemplo ya montada para ver cómo funciona todo.
          </li>
          <li>
            <strong>Empezar en blanco</strong>: un proyecto vacío con una guía de tres pasos.
          </li>
        </ul>
        <p className="text-xs text-slate-600">Todo se guarda en este navegador. Después verás una visita guiada de 5 pasos (puedes saltarla).</p>
      </div>
    </Modal>
  );
}
