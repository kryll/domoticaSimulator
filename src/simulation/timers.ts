// Temporizadores internos del motor (autoapagado, recorridos, `for` de los disparadores...) en
// sim.pending, identificados por clave. Funciones puras.
import type { EntityStateValue, PendingAction, Project, SimTimer, SimulationState } from '../types';
import { inNumericRange } from './stateUtils';

/** Clave del temporizador propio de una entidad (autoapagado, recorrido, vuelta a la base). */
export function entityTimerKey(entityId: string): string {
  return `entity:${entityId}`;
}

/** ¿Es un temporizador interno del motor (no una espera de automatización o script)? */
export function isTimer(p: PendingAction): boolean {
  return p.timer !== undefined;
}

/** Esperas (delay) de automatizaciones y scripts, sin los temporizadores internos. */
export function userWaits(sim: SimulationState): PendingAction[] {
  return sim.pending.filter((p) => !isTimer(p));
}

/** Programa un temporizador interno; sustituye al que tenga la misma clave. */
export function scheduleTimer(sim: SimulationState, key: string, dueAt: number, timer: SimTimer): SimulationState {
  const pending = sim.pending.filter((p) => p.key !== key);
  return { ...sim, pending: [...pending, { id: `timer:${key}`, dueAt, actions: [], timer, key }] };
}

export function cancelTimer(sim: SimulationState, key: string): SimulationState {
  if (!sim.pending.some((p) => p.key === key)) return sim;
  return { ...sim, pending: sim.pending.filter((p) => p.key !== key) };
}

/** Temporizador interno con esa clave, si existe. */
export function findTimer(sim: SimulationState, key: string): PendingAction | undefined {
  return sim.pending.find((p) => p.key === key);
}

export function cancelStateFor(sim: SimulationState, entityId: string, project?: Project, next?: EntityStateValue): SimulationState {
  const stillInRange = (p: PendingAction): boolean => {
    // Tanda 3: numeric_state con `for` sigue contando mientras el valor no salga del rango.
    if (p.timer?.kind !== 'state_for' || !project || next === undefined) return false;
    const timer = p.timer;
    const t = project.automations.find((a) => a.id === timer.automationId)?.triggers[timer.triggerIndex];
    return t?.type === 'numeric_state' && inNumericRange(next, t.above, t.below);
  };
  const keep = sim.pending.filter((p) => !((p.timer?.kind === 'state_for' || p.timer?.kind === 'wait_for') && p.timer.entityId === entityId) || stillInRange(p));
  return keep.length === sim.pending.length ? sim : { ...sim, pending: keep };
}
