// Escenarios de fallo con un clic (B2) e informe de impacto: qué dispositivos caen y qué
// automatizaciones, escenas y scripts dejan de funcionar. Funciones puras.
import type { Action, Condition, DeviceDefinition, Failures, Id, Project, Trigger } from '../types';
import { entitiesForDevice } from '../devices/entities';
import { isThreadBorderRouter } from '../devices/roles';
import { NO_FAILURES } from './connectivity';
import { unavailabilityReasons } from './availability';
import { findScene, findScript } from './engine';

export type FailureScenarioId = 'internet' | 'coordinator' | 'power' | 'ha_restart' | 'hub';

export interface FailureScenario {
  id: FailureScenarioId;
  name: string;
  description: string;
  /** Fallos que aplica el escenario en este proyecto. */
  failures: (project: Project, defs: DeviceDefinition[]) => Partial<Failures>;
}

function devicesWhere(project: Project, defs: DeviceDefinition[], pred: (def: DeviceDefinition) => boolean): Id[] {
  return project.devices.filter((d) => {
    const def = defs.find((x) => x.id === d.definitionId);
    return def !== undefined && pred(def);
  }).map((d) => d.id);
}

export const FAILURE_SCENARIOS: FailureScenario[] = [
  {
    id: 'internet',
    name: 'Se cae Internet',
    description: 'El router sigue funcionando pero no hay salida a Internet: dejan de responder las integraciones en la nube.',
    failures: () => ({ internet: true }),
  },
  {
    id: 'coordinator',
    name: 'Falla el coordinador',
    description: 'Se desconectan los coordinadores Zigbee y los controladores Z-Wave: caen sus redes y todo lo que cuelga de ellas.',
    failures: (project, defs) => ({ devicesDown: devicesWhere(project, defs, (d) => d.role === 'coordinator') }),
  },
  {
    id: 'power',
    name: 'Corte de luz',
    description: 'Se va la luz: cae todo lo enchufado (red eléctrica, PoE o USB) salvo lo que tiene SAI; los dispositivos a pilas siguen, pero sin su coordinador no llegan a Home Assistant.',
    failures: () => ({ powerOutage: true }),
  },
  {
    id: 'ha_restart',
    name: 'Home Assistant se reinicia',
    description: 'Mientras Home Assistant se reinicia no se ejecuta ninguna automatización.',
    failures: () => ({ haRestarting: true }),
  },
  {
    id: 'hub',
    name: 'Fallan los hubs',
    description: 'Se desconectan los hubs y puentes propietarios (Hue, Aqara, DIRIGERA...) y los border routers Thread.',
    failures: (project, defs) => ({ devicesDown: devicesWhere(project, defs, (d) => d.role === 'hub' || isThreadBorderRouter(d)) }),
  },
];

export function findScenario(id: FailureScenarioId): FailureScenario | undefined {
  return FAILURE_SCENARIOS.find((s) => s.id === id);
}

/** Fallos completos de un escenario (los no indicados, sin fallo). */
export function scenarioFailures(id: FailureScenarioId, project: Project, defs: DeviceDefinition[]): Failures {
  const s = findScenario(id);
  return { ...NO_FAILURES, ...(s ? s.failures(project, defs) : {}) };
}

// ---------- Informe de impacto ----------

export type ImpactStatus = 'ok' | 'degraded' | 'broken';

export interface ImpactItem {
  status: ImpactStatus;
  reasons: string[];
}

export interface ImpactReport {
  unavailableDevices: { deviceId: Id; reason: string }[];
  /** entity_id no disponibles (de los dispositivos caídos). */
  unavailableEntities: string[];
  automations: ({ automationId: Id } & ImpactItem)[];
  scenes: ({ sceneId: Id } & ImpactItem)[];
  scripts: ({ scriptId: Id } & ImpactItem)[];
  /** Resumen en una línea, en español. */
  summary: string;
}

interface DownEntity {
  name: string;
  reason: string;
}

function downEntities(project: Project, defs: DeviceDefinition[], reasons: Map<Id, string>): Map<string, DownEntity> {
  const map = new Map<string, DownEntity>();
  for (const device of project.devices) {
    const reason = reasons.get(device.id);
    const def = defs.find((d) => d.id === device.definitionId);
    if (reason === undefined || !def) continue;
    for (const e of entitiesForDevice(device, def)) map.set(e.entityId, { name: e.friendlyName, reason: `«${device.name}»: ${reason}` });
  }
  return map;
}

function triggerEntity(t: Trigger): string | undefined {
  return t.type === 'state' || t.type === 'numeric_state' ? t.entityId : undefined;
}

function conditionEntities(c: Condition): string[] {
  if (c.type === 'and' || c.type === 'or') return c.conditions.flatMap(conditionEntities);
  return c.type === 'state' || c.type === 'numeric_state' ? [c.entityId] : [];
}

/** entity_id que tocan unas acciones (escenas y scripts incluidos, sin repetir ciclos). */
function actionEntities(actions: Action[], project: Project, seen: Set<string> = new Set()): string[] {
  const out: string[] = [];
  for (const a of actions) {
    if (a.type === 'delay') continue;
    const sceneRef = a.type === 'scene' ? a.sceneId : a.type === 'service' && a.service === 'scene.turn_on' ? a.entityId : undefined;
    const scriptRef =
      a.type === 'script' ? a.scriptId : a.type === 'service' && a.service.startsWith('script.') ? (a.service === 'script.turn_on' ? a.entityId : a.service) : undefined;
    if (sceneRef !== undefined) {
      const scene = findScene(project, sceneRef);
      if (scene && !seen.has(`scene:${scene.id}`)) {
        seen.add(`scene:${scene.id}`);
        out.push(...Object.keys(scene.entities));
      }
    } else if (scriptRef !== undefined) {
      const script = findScript(project, scriptRef);
      if (script && !seen.has(`script:${script.id}`)) {
        seen.add(`script:${script.id}`);
        out.push(...actionEntities(script.sequence, project, seen));
      }
    } else if (a.type === 'service') {
      out.push(a.entityId);
    }
  }
  return out;
}

function describeDown(kind: string, entityId: string, down: DownEntity): string {
  return `${kind}: ${down.name} (${entityId}) no está disponible; ${down.reason}`;
}

/** broken si todo lo afectado cae; degraded si solo parte; ok si nada. */
function partialStatus(total: number, fallen: number): ImpactStatus {
  if (fallen === 0) return 'ok';
  return fallen >= total ? 'broken' : 'degraded';
}

const unique = (ids: string[]): string[] => [...new Set(ids)];

const HA_RESTART_REASON = 'Home Assistant se está reiniciando: no se pueden activar escenas ni ejecutar scripts';

/**
 * Qué deja de funcionar con estos fallos: dispositivos no disponibles (con motivo) y estado de
 * cada automatización (broken si su disparador depende de una entidad caída o HA se reinicia;
 * degraded si alguna condición o acción depende de una entidad caída), escena y script.
 */
export function failureImpact(project: Project, defs: DeviceDefinition[], failures: Failures): ImpactReport {
  const reasons = unavailabilityReasons(project, defs, failures);
  const down = downEntities(project, defs, reasons);
  const unavailableDevices = [...reasons.entries()].map(([deviceId, reason]) => ({ deviceId, reason }));

  const automations = project.automations.map((a) => {
    const result: string[] = [];
    if (failures.haRestarting) result.push('Home Assistant se está reiniciando: no se ejecuta ninguna automatización');
    const triggerIds = a.triggers.map(triggerEntity);
    const fallenTriggers = triggerIds.filter((id): id is string => id !== undefined && down.has(id));
    for (const [i, id] of triggerIds.entries()) {
      const d = id === undefined ? undefined : down.get(id);
      if (id !== undefined && d) result.push(describeDown(`Disparador ${i + 1}`, id, d));
    }
    let status: ImpactStatus = failures.haRestarting ? 'broken' : partialStatus(a.triggers.length, fallenTriggers.length);
    const extra: string[] = [];
    for (const id of unique(a.conditions.flatMap(conditionEntities))) {
      const d = down.get(id);
      if (d) extra.push(describeDown('Condición', id, d));
    }
    for (const id of unique(actionEntities(a.actions, project))) {
      const d = down.get(id);
      if (d) extra.push(describeDown('Acción', id, d));
    }
    if (extra.length > 0 && status === 'ok') status = 'degraded';
    return { automationId: a.id, status, reasons: [...result, ...extra] };
  });

  const scenes = project.scenes.map((s) => {
    const ids = Object.keys(s.entities);
    const fallen = ids.filter((id) => down.has(id));
    const reasonsList = fallen.map((id) => describeDown('Entidad', id, down.get(id) ?? { name: id, reason: '' }));
    if (failures.haRestarting) return { sceneId: s.id, status: 'broken' as const, reasons: [HA_RESTART_REASON, ...reasonsList] };
    return { sceneId: s.id, status: partialStatus(ids.length, fallen.length), reasons: reasonsList };
  });

  const scripts = project.scripts.map((s) => {
    const ids = unique(actionEntities(s.sequence, project));
    const fallen = ids.filter((id) => down.has(id));
    const reasonsList = fallen.map((id) => describeDown('Acción', id, down.get(id) ?? { name: id, reason: '' }));
    if (failures.haRestarting) return { scriptId: s.id, status: 'broken' as const, reasons: [HA_RESTART_REASON, ...reasonsList] };
    return { scriptId: s.id, status: partialStatus(ids.length, fallen.length), reasons: reasonsList };
  });

  const count = (items: ImpactItem[], st: ImpactStatus): number => items.filter((x) => x.status === st).length;
  const autos = automations.length === 0 ? '' : `; automatizaciones: ${count(automations, 'broken')} rotas y ${count(automations, 'degraded')} degradadas de ${automations.length}`;
  const summary = `${unavailableDevices.length} dispositivo${unavailableDevices.length === 1 ? '' : 's'} sin servicio${autos}`;

  return { unavailableDevices, unavailableEntities: [...down.keys()], automations, scenes, scripts, summary };
}

/** Impacto de un escenario predefinido. */
export function scenarioImpact(project: Project, defs: DeviceDefinition[], id: FailureScenarioId): ImpactReport {
  return failureImpact(project, defs, scenarioFailures(id, project, defs));
}
