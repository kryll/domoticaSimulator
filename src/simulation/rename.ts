// Renombrado de entidades en el estado de la simulación (al renombrar un dispositivo). Puro.
import type { Action, EntityState, Id, PendingAction, SimTimer, SimulationState } from '../types';
import { mapActionEntities, mapTriggerEntities } from '../automations/walk';
import { ATTRIBUTE_SEPARATOR } from './history';
import { entityTimerKey } from './timers';

function renameKey<T>(record: Record<string, T>, mapping: Record<string, string>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) out[mapping[k] ?? k] = v;
  return out;
}

function renameTimer(timer: SimTimer, mapping: Record<string, string>): SimTimer {
  const ren = (id: string): string => mapping[id] ?? id;
  switch (timer.kind) {
    case 'set_states':
      return { ...timer, setStates: renameKey(timer.setStates, mapping) };
    case 'cover_step':
    case 'state_for':
    case 'service_call':
    case 'wait_for':
    case 'helper_timer':
    case 'vacuum_step':
      return { ...timer, entityId: ren(timer.entityId) };
    case 'timeline_event':
      return timer.step.entityId === undefined ? timer : { ...timer, step: { ...timer.step, entityId: ren(timer.step.entityId) } };
  }
}

function renameActions(actions: Action[], mapping: Record<string, string>): Action[] {
  return actions.map((a) => mapActionEntities(a, (id) => mapping[id] ?? id));
}

function renamePending(p: PendingAction, mapping: Record<string, string>): PendingAction {
  const next: PendingAction = { ...p, actions: renameActions(p.actions, mapping) };
  if (p.wait) next.wait = { ...p.wait, triggers: p.wait.triggers.map((t) => mapTriggerEntities(t, (id) => mapping[id] ?? id)) };
  if (p.timer) {
    next.timer = renameTimer(p.timer, mapping);
    const entityId = p.key?.startsWith('entity:') ? p.key.slice(7) : undefined;
    if (entityId !== undefined && mapping[entityId]) {
      next.key = entityTimerKey(mapping[entityId] ?? entityId);
      next.id = `timer:${next.key}`;
    }
  }
  return next;
}

/**
 * Traslada el estado de la simulación a entity_id nuevos (dispositivo renombrado): entidades,
 * temporizadores (claves, entityId, setStates, state_for), esperas, cola y dispositivos offline.
 * `mapping`: entity_id anterior -> entity_id nuevo. Función pura.
 */
export function renameEntities(sim: SimulationState, mapping: Record<string, string>): SimulationState {
  const pairs = Object.entries(mapping).filter(([from, to]) => from !== to);
  if (pairs.length === 0) return sim;
  const map = Object.fromEntries(pairs);
  const next: SimulationState = {
    ...sim,
    entities: renameKey(sim.entities, map),
    pending: sim.pending.map((p) => renamePending(p, map)),
  };
  if (sim.queue) next.queue = sim.queue.map((p) => renamePending(p, map));
  if (sim.joins) next.joins = Object.fromEntries(Object.entries(sim.joins).map(([id, j]) => [id, { ...j, cont: renamePending(j.cont, map) }]));
  if (sim.history) {
    // Series de estado y de atributos («entity#atributo») con el entity_id nuevo.
    const history: NonNullable<SimulationState['history']> = {};
    for (const [key, samples] of Object.entries(sim.history)) {
      const cut = key.indexOf(ATTRIBUTE_SEPARATOR);
      const id = cut === -1 ? key : key.slice(0, cut);
      history[(map[id] ?? id) + (cut === -1 ? '' : key.slice(cut))] = samples;
    }
    next.history = history;
  }
  if (sim.offline) {
    const offline: Record<Id, Record<string, EntityState>> = {};
    for (const [deviceId, states] of Object.entries(sim.offline)) offline[deviceId] = renameKey(states, map);
    next.offline = offline;
  }
  return next;
}
