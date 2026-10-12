// Escenarios de fallo con un clic (B2) e informe de impacto: qué dispositivos caen y qué
// automatizaciones, escenas y scripts dejan de funcionar. Funciones puras.
import type { Action, Condition, DeviceDefinition, Failures, Id, Project, Trigger } from '../types';
import { entitiesForDevice } from '../devices/entities';
import { isThreadBorderRouter } from '../devices/roles';
import { internetAvailable, NO_FAILURES } from './connectivity';
import { isCloudNotifyService } from './notify';
import { unavailabilityReasons } from './availability';
import { findScene, findScript } from './engine';
import { findGroupByEntity } from './logic';
import { actionConditions, conditionEntityIds, flattenActions, serviceEntityIds, triggerEntityIds } from '../automations/walk';
import { resolveServiceTargets } from '../devices/areas';
import { plural } from '../ui/plural';
import { allDefinitions } from '../devices/catalog';

export type FailureScenarioId = 'internet' | 'coordinator' | 'power' | 'ha_restart' | 'hub';

export interface FailureScenario {
  id: FailureScenarioId;
  name: string;
  description: string;
  /** Fallos que aplica el escenario en este proyecto. */
  failures: (project: Project, defs: DeviceDefinition[]) => Partial<Failures>;
}

function devicesWhere(project: Project, baseDefs: DeviceDefinition[], pred: (def: DeviceDefinition) => boolean): Id[] {
  const defs = allDefinitions(project, baseDefs);
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

/** entity_id de la que depende un disparador (state, numeric_state y device_action de la Fase 3). */
function triggerEntity(t: Trigger): string | undefined {
  return triggerEntityIds(t)[0];
}

/** entity_id de una condición, anidadas incluidas (and/or/not), con walk.ts. */
const conditionEntities = (c: Condition): string[] => conditionEntityIds(c);

/** Miembros de un grupo de la Fase 3 (light.grupo_x → sus luces); si no es un grupo, la propia entidad. */
function expandGroup(project: Project, entityId: string): string[] {
  const group = findGroupByEntity(project, entityId);
  return group ? group.entityIds : [entityId];
}

/**
 * entity_id que tocan unas acciones (escenas y scripts incluidos, sin repetir ciclos). Recorre
 * con walk.ts las acciones anidadas de la Fase 3 (choose/if/repeat), sus condiciones y los
 * disparadores de wait_for_trigger.
 */
function actionEntities(actions: Action[], project: Project, defs?: DeviceDefinition[], seen: Set<string> = new Set()): string[] {
  const out: string[] = [];
  for (const a of flattenActions(actions)) {
    out.push(...actionConditions(a).flatMap(conditionEntityIds));
    if (a.type === 'wait_for_trigger') out.push(...a.triggers.flatMap(triggerEntityIds));
    if (a.type !== 'service' && a.type !== 'scene' && a.type !== 'script') continue;
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
        out.push(...actionEntities(script.sequence, project, defs, seen));
      }
    } else if (a.type === 'service') {
      // notify.* no tiene entidad; un grupo depende de sus miembros. Tanda 1: también los
      // destinos adicionales y las entidades de las áreas (salas) de destino.
      for (const id of defs ? resolveServiceTargets(project, defs, a) : serviceEntityIds(a)) out.push(...expandGroup(project, id));
    }
  }
  return out;
}

/** Condiciones de zona (anidadas incluidas). */
function zoneConditions(c: Condition): Condition[] {
  if (c.type === 'and' || c.type === 'or' || c.type === 'not') return c.conditions.flatMap(zoneConditions);
  return c.type === 'zone' ? [c] : [];
}

/** Notificaciones que salen por la nube (notify.* salvo la persistente y la acción notify). */
function cloudNotifications(actions: Action[], project: Project, seen: Set<string> = new Set()): number {
  let n = 0;
  for (const a of flattenActions(actions)) {
    if (a.type === 'notify' && isCloudNotifyService(a.service ?? 'notify.notify')) n++;
    if (a.type === 'service' && isCloudNotifyService(a.service)) n++;
    const scriptRef = a.type === 'script' ? a.scriptId : a.type === 'service' && a.service.startsWith('script.') ? (a.service === 'script.turn_on' ? a.entityId : a.service) : undefined;
    const script = scriptRef === undefined ? undefined : findScript(project, scriptRef);
    if (script && !seen.has(script.id)) {
      seen.add(script.id);
      n += cloudNotifications(script.sequence, project, seen);
    }
  }
  return n;
}

const ZONE_OFFLINE = 'la ubicación de las personas llega desde la app móvil por Internet';
const NOTIFY_OFFLINE = 'las notificaciones a la app móvil necesitan Internet';

/** Motivos de degradación sin Internet: zonas (disparadores y condiciones) y notificaciones. */
function offlineReasons(triggers: Trigger[], conditions: Condition[], actions: Action[], project: Project): string[] {
  const out: string[] = [];
  triggers.forEach((t, i) => {
    if (t.type === 'zone') out.push(`Disparador ${i + 1}: ${ZONE_OFFLINE}`);
  });
  if (conditions.flatMap(zoneConditions).length > 0 || flattenActions(actions).some((a) => actionConditions(a).flatMap(zoneConditions).length > 0)) {
    out.push(`Condición de zona: ${ZONE_OFFLINE}`);
  }
  if (cloudNotifications(actions, project) > 0) out.push(`Acción: ${NOTIFY_OFFLINE}`);
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
export function failureImpact(project: Project, baseDefs: DeviceDefinition[], failures: Failures): ImpactReport {
  const defs = allDefinitions(project, baseDefs);
  const reasons = unavailabilityReasons(project, defs, failures);
  const down = downEntities(project, defs, reasons);
  const unavailableDevices = [...reasons.entries()].map(([deviceId, reason]) => ({ deviceId, reason }));
  const offline = !internetAvailable(project, defs, failures);

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
    // Tanda 3: con un disparador de arranque de HA, la automatización se ejecutará al volver.
    if (failures.haRestarting && a.triggers.some((t) => t.type === 'homeassistant' && t.event === 'start' && t.enabled !== false)) {
      status = 'degraded';
      result.push('Se ejecutará cuando Home Assistant vuelva a arrancar (disparador de arranque)');
    }
    const extra: string[] = [];
    for (const id of unique(a.conditions.flatMap(conditionEntities))) {
      const d = down.get(id);
      if (d) extra.push(describeDown('Condición', id, d));
    }
    for (const id of unique(actionEntities(a.actions, project, defs))) {
      const d = down.get(id);
      if (d) extra.push(describeDown('Acción', id, d));
    }
    if (offline) extra.push(...offlineReasons(a.triggers, a.conditions, a.actions, project));
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
    const ids = unique(actionEntities(s.sequence, project, defs));
    const fallen = ids.filter((id) => down.has(id));
    const reasonsList = fallen.map((id) => describeDown('Acción', id, down.get(id) ?? { name: id, reason: '' }));
    if (failures.haRestarting) return { scriptId: s.id, status: 'broken' as const, reasons: [HA_RESTART_REASON, ...reasonsList] };
    const notes = offline ? offlineReasons([], [], s.sequence, project) : [];
    const status = partialStatus(ids.length, fallen.length);
    return { scriptId: s.id, status: status === 'ok' && notes.length > 0 ? ('degraded' as const) : status, reasons: [...reasonsList, ...notes] };
  });

  const count = (items: ImpactItem[], st: ImpactStatus): number => items.filter((x) => x.status === st).length;
  const autos = automations.length === 0 ? '' : `; automatizaciones: ${count(automations, 'broken')} ${plural(count(automations, 'broken'), 'rota', 'rotas')} y ${count(automations, 'degraded')} ${plural(count(automations, 'degraded'), 'degradada', 'degradadas')} de ${automations.length}`;
  const summary = `${unavailableDevices.length} ${plural(unavailableDevices.length, 'dispositivo', 'dispositivos')} sin servicio${autos}`;

  return { unavailableDevices, unavailableEntities: [...down.keys()], automations, scenes, scripts, summary };
}

/** Impacto de un escenario predefinido. */
export function scenarioImpact(project: Project, defs: DeviceDefinition[], id: FailureScenarioId): ImpactReport {
  defs = allDefinitions(project, defs);
  return failureImpact(project, defs, scenarioFailures(id, project, defs));
}
