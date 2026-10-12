import { create } from 'zustand';
import type { EntityState, EntityStateValue, Id, Project, SimulationState } from '../types';
import { catalog } from '../devices/catalog';
import { initialEntityStates } from '../devices/entities';
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
  activateScene: (sceneId: Id) => void;
  runScript: (scriptId: Id) => void;
  /** Añade las entidades nuevas del proyecto que aún no estén en la simulación. */
  syncWithProject: (project: Project) => void;
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
  sim: createSimulationState(project(), catalog, Date.now()),
  running: false,
  speed: 1,

  reset: (p) => {
    stopLoop();
    const sim = createSimulationState(p ?? project(), catalog, Date.now());
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
  activateScene: (sceneId) => set((s) => ({ sim: activateScene(s.sim, project(), sceneId) })),
  runScript: (scriptId) => set((s) => ({ sim: runScript(s.sim, project(), scriptId) })),
  syncWithProject: (p) => {
    const initial = initialEntityStates(p, catalog);
    const current = get().sim.entities;
    const missing = Object.keys(initial).filter((id) => !(id in current));
    if (missing.length === 0) return;
    const entities = { ...current };
    for (const id of missing) {
      const state = initial[id];
      if (state) entities[id] = state;
    }
    set((s) => ({ sim: { ...s.sim, entities } }));
  },
}));

/** Mantiene la simulación al día con los dispositivos del proyecto. */
export function startSimulationSync(): () => void {
  return useProjectStore.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    if (state.project.id !== prev.project.id) {
      useSimulationStore.getState().reset(state.project);
      return;
    }
    useSimulationStore.getState().syncWithProject(state.project);
  });
}

/** Detiene el bucle (útil en tests). */
export function stopSimulationLoop(): void {
  stopLoop();
}
