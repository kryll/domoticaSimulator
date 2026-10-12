// Pausa y velocidad con el laboratorio en vivo. En vivo HA va en tiempo real: acelerar no está
// disponible y pausar significa parar todos los nodos (HA los ve no disponibles), así que se
// pregunta antes. Los controles de la simulación (botón, tecla P y Ctrl+K) llaman aquí.
import { useSimulationStore } from '../store/simulationStore';
import { confirmDialog } from '../ui/confirm';
import { isBridgeLive } from './useBridge';

/** Texto del aviso de los controles de velocidad en vivo. */
export const LIVE_SPEED_HINT = 'Con el laboratorio en vivo la simulación va a 1x con la hora real (HA no se puede acelerar). Pausa para desacoplar y cambiar la velocidad.';

/** Pausa la simulación; en vivo pregunta «¿Parar todos los nodos?». Devuelve si se ha pausado. */
export async function pauseSimulation(): Promise<boolean> {
  if (!isBridgeLive()) {
    useSimulationStore.getState().pause();
    return true;
  }
  const ok = await confirmDialog({
    title: '¿Parar todos los nodos?',
    message:
      'El laboratorio está en vivo. Pausar la simulación para todos los nodos del lab: HA verá los dispositivos como no disponibles y sus comandos se ignorarán hasta que pulses «Volver a acoplar».',
    confirmLabel: 'Parar y pausar',
    danger: true,
  });
  if (!ok) return false;
  if (!isBridgeLive()) {
    useSimulationStore.getState().pause();
    return true;
  }
  const { pauseLive } = await import('./runtime');
  pauseLive();
  return true;
}
