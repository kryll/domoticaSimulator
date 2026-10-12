import { create } from 'zustand';
import type { EntityState, EntityStateValue, Id, Project, SimulationState } from '../types';
import { entitiesForDevice, initialEntityStates } from '../devices/entities';
import { catalog, getDefinition } from '../devices/catalog';
import { simNowFromLocalDate } from '../simulation/clock';
import { pressButton } from '../simulation/events';
import { activateScene, createSimulationState, runScript, setEntityState, tick } from '../simulation/engine';
import { useProjectStore } from './projectStore';

export const SPEEDS = [1, 10, 60, 600] as const;
export type Speed = (typeof SPEEDS)[number];

/** Intervalo real entre ticks del bucle de simulación. */
export const TICK_INTERVAL_MS = 250;

export interface SimulationStoreState {
  sim: SimulationState;
  running: boolean;
  speed: Speed;

  /** Crea un estado de simulación nuevo para el proyecto. */
  reset: (project?: Project) => void;
  start: () => void;
  pause: () => void;
  setSpeed: (speed: Speed) => void;
  /** Avanza la simulación `realMs` milisegundos reales (el motor aplica la velocidad). */
  advance: (realMs: number) => void;
  /** Cambia manualmente el estado de una entidad (evento simulado). */
  setEntity: (entityId: string, next: EntityState | EntityStateValue) => void;
  /** Pulsación de un mando (sensor de acción): single, double, hold... */
  pressButton: (entityId: string, action: string) => void;
  activateScene: (sceneId: Id) => void;
  runScript: (scriptId: Id) => void;
  /**
   * Ajusta las entidades de la simulación al proyecto: añade las nuevas, quita las que ya no
   * existen y traslada el estado de las renombradas (comparando con `prev`).
   */
  syncWithProject: (project: Project, prev?: Project) => void;
}

let loop: ReturnType<typeof setInterval> | undefined;
let lastTick = 0;

function stopLoop() {
  if (loop) clearInterval(loop);
  loop = undefined;
}

function project(): Project {
  return useProjectStore.getState().project;
}

export const useSimulationStore = create<SimulationStoreState>()((set, get) => ({
  sim: createSimulationState(project(), catalog, simNowFromLocalDate(new Date())),
  running: false,
  speed: 1,

  reset: (p) => {
    stopLoop();
    const sim = createSimulationState(p ?? project(), catalog, simNowFromLocalDate(new Date()));
    set({ sim: { ...sim, speed: get().speed, running: false }, running: false });
  },
  start: () => {
    if (get().running) return;
    lastTick = performance.now();
    set((s) => ({ running: true, sim: { ...s.sim, running: true } }));
    stopLoop();
    loop = setInterval(() => {
      const now = performance.now();
      const elapsed = now - lastTick;
      lastTick = now;
      get().advance(elapsed);
    }, TICK_INTERVAL_MS);
  },
  pause: () => {
    stopLoop();
    set((s) => ({ running: false, sim: { ...s.sim, running: false } }));
  },
  setSpeed: (speed) => set((s) => ({ speed, sim: { ...s.sim, speed } })),
  advance: (realMs) => {
    // tick multiplica por sim.speed, que se mantiene sincronizado con `speed`.
    set((s) => ({ sim: tick(s.sim, project(), realMs) }));
  },
  setEntity: (entityId, next) => set((s) => ({ sim: setEntityState(s.sim, project(), entityId, next) })),
  pressButton: (entityId, action) => set((s) => ({ sim: pressButton(s.sim, project(), entityId, action) })),
  activateScene: (sceneId) => set((s) => ({ sim: activateScene(s.sim, project(), sceneId) })),
  runScript: (scriptId) => set((s) => ({ sim: runScript(s.sim, project(), scriptId) })),
  syncWithProject: (p, prev) => {
    const current = get().sim.entities;
    const renamed = prev ? renamedEntityIds(prev, p) : new Map<string, string>();
    const initial = initialEntityStates(p, catalog);
    const entities: SimulationState['entities'] = {};
    let changed = false;
    for (const [id, init] of Object.entries(initial)) {
      const oldId = renamed.get(id);
      const kept = current[id] ?? (oldId !== undefined ? current[oldId] : undefined);
      if (kept) {
        // conserva el estado pero actualiza atributos derivados del nombre (friendly_name)
        entities[id] = { ...kept, attributes: { ...kept.attributes, friendly_name: init.attributes?.friendly_name ?? id } };
        if (!current[id] || kept.attributes?.friendly_name !== init.attributes?.friendly_name) changed = true;
      } else {
        entities[id] = init;
        changed = true;
      }
    }
    if (Object.keys(current).some((id) => !(id in entities))) changed = true;
    if (!changed) return;
    set((s) => ({ sim: { ...s.sim, entities } }));
  },
}));

/** entity_id nuevo -> entity_id anterior de los dispositivos cuyo nombre ha cambiado. */
export function renamedEntityIds(prev: Project, next: Project): Map<string, string> {
  const map = new Map<string, string>();
  const before = new Map(prev.devices.map((d) => [d.id, d]));
  for (const device of next.devices) {
    const old = before.get(device.id);
    if (!old || old.name === device.name || old.definitionId !== device.definitionId) continue;
    const def = getDefinition(device.definitionId, catalog);
    if (!def) continue;
    const oldIds = entitiesForDevice(old, def);
    entitiesForDevice(device, def).forEach((e, i) => {
      const o = oldIds[i];
      if (o && o.entityId !== e.entityId) map.set(e.entityId, o.entityId);
    });
  }
  return map;
}

/** Mantiene la simulación al día con los dispositivos del proyecto. */
export function startSimulationSync(): () => void {
  return useProjectStore.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    if (state.project.id !== prev.project.id) {
      useSimulationStore.getState().reset(state.project);
      return;
    }
    useSimulationStore.getState().syncWithProject(state.project, prev.project);
  });
}

/** Detiene el bucle (útil en tests). */
export function stopSimulationLoop(): void {
  stopLoop();
}
