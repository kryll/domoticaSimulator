// Atajos para simular eventos físicos desde la interfaz o los tests.
import type { Project, SimulationState } from '../types';
import { setEntityState } from './engine';

/** Movimiento detectado (on) o dejado de detectar (off) en un binary_sensor. */
export function triggerMotion(sim: SimulationState, project: Project, entityId: string, detected = true): SimulationState {
  return setEntityState(sim, project, entityId, detected ? 'on' : 'off');
}

/** Abre (on) o cierra (off) un sensor de puerta/ventana. */
export function openDoor(sim: SimulationState, project: Project, entityId: string, open = true): SimulationState {
  return setEntityState(sim, project, entityId, open ? 'on' : 'off');
}

export function closeDoor(sim: SimulationState, project: Project, entityId: string): SimulationState {
  return openDoor(sim, project, entityId, false);
}

/** Fija la lectura de un sensor de temperatura (redondeada a una décima). */
export function setTemperature(sim: SimulationState, project: Project, entityId: string, celsius: number): SimulationState {
  return setEntityState(sim, project, entityId, Math.round(celsius * 10) / 10);
}

/** Fija una lectura numérica genérica (humedad, iluminancia, potencia...). */
export function setSensorValue(sim: SimulationState, project: Project, entityId: string, value: number): SimulationState {
  return setEntityState(sim, project, entityId, value);
}

/** Pulsación de un mando inalámbrico (sensor de acción): "single", "double", "hold"... */
export function pressButton(sim: SimulationState, project: Project, entityId: string, action = 'single'): SimulationState {
  const pressed = setEntityState(sim, project, entityId, action);
  return setEntityState(pressed, project, entityId, 'none');
}
