import { create } from 'zustand';
import type { EntityState, EntityStateValue, Id, Project, ServiceData, SimulationState } from '../types';
import { entitiesForDevice, initialEntityStates } from '../devices/entities';
import { catalog, getDefinition } from '../devices/catalog';
import { applyQuickAction, primaryAction, setLevelAction, stepAction, type QuickAction } from '../devices/presentation';
import { simNowFromLocalDate } from '../simulation/clock';
import { jamLock, motionPulse, openDoor, pressButton, setDeviceOffline, setSensorValue } from '../simulation/events';
import {
  activateScene,
  callService,
  createSimulationState,
  runAutomation,
  runScript,
  setEntityState,
  tick,
} from '../simulation/engine';
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
  /** Llama a un servicio de HA ("turn_on" o "light.turn_on") sobre una entidad. */
  callService: (entityId: string, service: string, data?: ServiceData) => void;
  /** Acción principal del dispositivo (encender/apagar, abrir/cerrar...). Devuelve si hizo algo. */
  quickAction: (deviceId: Id) => boolean;
  /** Sube (+1) o baja (-1) el nivel: brillo, posición, volumen o consigna. */
  step: (deviceId: Id, direction: 1 | -1) => boolean;
  /** Fija el nivel en % (0 = apagar / cerrar). */
  setLevel: (deviceId: Id, pct: number) => boolean;
  /** Ejecuta una automatización a mano (opcionalmente sin comprobar condiciones). */
  runAutomation: (automationId: Id, skipConditions?: boolean) => void;
  /** Simula que un dispositivo pierde (o recupera) la conexión. */
  setDeviceOffline: (deviceId: Id, offline: boolean) => void;
  /** Movimiento detectado con autoapagado según el modelo. */
  motionPulse: (entityId: string, seconds?: number) => void;
  /** Sensor binario a on/off (puerta, fuga, humo...). */
  setBinary: (entityId: string, on: boolean) => void;
  setSensorValue: (entityId: string, value: number) => void;
  jamLock: (entityId: string) => void;
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
  callService: (entityId, service, data) =>
    set((s) => ({ sim: callService(s.sim, project(), entityId, normalizeService(entityId, service), data) })),
  quickAction: (deviceId) => applyDeviceAction(deviceId, (device, def, sim) => primaryAction(device, def, sim)),
  step: (deviceId, direction) => applyDeviceAction(deviceId, (device, def, sim) => stepAction(device, def, sim, direction)),
  setLevel: (deviceId, pct) =>
    applyDeviceAction(deviceId, (device, def, sim) => setLevelAction(device, def, sim, Math.max(0, Math.min(100, pct)))),
  runAutomation: (automationId, skipConditions = false) =>
    set((s) => ({ sim: runAutomation(s.sim, project(), automationId, { skipConditions }) })),
  setDeviceOffline: (deviceId, offline) => set((s) => ({ sim: setDeviceOffline(s.sim, project(), deviceId, offline) })),
  motionPulse: (entityId, seconds) => set((s) => ({ sim: motionPulse(s.sim, project(), entityId, seconds) })),
  setBinary: (entityId, on) => set((s) => ({ sim: openDoor(s.sim, project(), entityId, on) })),
  setSensorValue: (entityId, value) => set((s) => ({ sim: setSensorValue(s.sim, project(), entityId, value) })),
  jamLock: (entityId) => set((s) => ({ sim: jamLock(s.sim, project(), entityId) })),
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

/** "turn_on" -> "light.turn_on" (el motor recibe siempre dominio.servicio). */
export function normalizeService(entityId: string, service: string): string {
  if (service.includes('.')) return service;
  const dot = entityId.indexOf('.');
  return dot === -1 ? service : `${entityId.slice(0, dot)}.${service}`;
}

type ActionPicker = (
  device: Project['devices'][number],
  def: NonNullable<ReturnType<typeof getDefinition>>,
  sim: SimulationState,
) => QuickAction | null | undefined;

/** Calcula una acción rápida sobre un dispositivo y la aplica. */
function applyDeviceAction(deviceId: Id, pick: ActionPicker): boolean {
  const p = project();
  const device = p.devices.find((d) => d.id === deviceId);
  const def = device ? getDefinition(device.definitionId, catalog) : undefined;
  if (!device || !def) return false;
  const { sim } = useSimulationStore.getState();
  const action = pick(device, def, sim);
  if (!action) return false;
  useSimulationStore.setState({ sim: applyQuickAction(sim, p, action) });
  return true;
}

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

/**
 * Al entrar en modo Uso arranca la simulación si está en pausa: sin reloj, los temporizadores
 * (recorrido de persianas, autoapagado del movimiento) no avanzan.
 */
export function startInteractAutoplay(
  subscribe: (listener: (mode: string, prev: string) => void) => () => void,
  onStarted?: () => void,
): () => void {
  return subscribe((mode, prev) => {
    if (mode !== 'interact' || prev === 'interact') return;
    const sim = useSimulationStore.getState();
    if (sim.running) return;
    sim.start();
    onStarted?.();
  });
}
