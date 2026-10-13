// Validador del proyecto: reglas de red y de dominio con códigos estables y mensajes en español.
import type { Action, Brand, Condition, Device, Integration, DeviceDefinition, Id, IssueRef, IssueSeverity, Project, Trigger, ValidationIssue } from '../types';
import { INTEGRATION_LABELS } from '../devices/labels';
import { allDefinitions, isCloud, validateDefinition } from '../devices/catalog';
import { helperEntityId, helperEntityIds, validateHelper } from '../simulation/helpers';
import { timePatternSets } from '../simulation/engine';
import {
  effectiveIotClass,
  isBleProxy,
  isInfra,
  isRfBridge,
  isThreadBorderRouter,
  isZigbeeCoordinator,
  isZwaveController,
  requiredHubBrand,
  zigbeeNetworkOf,
} from '../devices/roles';
import { entityIdsForDevice, slugify } from '../devices/entities';
import { collectEntityRefs, type EntityReference } from '../devices/renaming';
import { findScene, findScript } from '../simulation/engine';
import { groupEntityId, peopleEntities, projectZones } from '../simulation/logic';
import { zoneConflicts } from '../simulation/zones';
import { missingRequiredFields } from '../simulation/serviceCatalog';
import { actionConditions, flattenActions, serviceAreaIds, serviceEntityIds } from '../automations/walk';
import { areaEntityIds } from '../devices/areas';
import { canConnect } from './connections';
import { parseAreaIds, unknownVacuumRooms } from '../simulation/vacuum';
import { TTS_ENTITIES } from '../simulation/voice';
import { isInRange } from './coverage';
import { analyzeMesh } from './mesh';

interface Placed {
  device: Device;
  def: DeviceDefinition;
}

interface Ctx {
  project: Project;
  defs: DeviceDefinition[];
  placed: Placed[];
}

/** Títulos legibles por código (el código es solo un dato estable para la lógica). */
export const ISSUE_TITLES: Record<string, string> = {
  'definicion-desconocida': 'Modelo desconocido',
  'sin-servidor-ha': 'Falta el servidor de Home Assistant',
  'zigbee-sin-coordinador': 'Falta el coordinador Zigbee',
  'varios-coordinadores-zigbee': 'Varios coordinadores Zigbee',
  'falta-hub-propietario': 'Falta el hub de la marca',
  'thread-sin-border-router': 'Falta un border router Thread',
  'zwave-sin-controlador': 'Falta el controlador Z-Wave',
  'rf433-sin-puente': 'Falta el puente RF 433 MHz',
  'thread-border-router-sin-credenciales': 'Border router Thread cerrado',
  'ble-sin-proxy': 'Sin proxy Bluetooth cerca',
  'integracion-cloud': 'Depende de la nube',
  'fuera-de-cobertura': 'Fuera de cobertura',
  'conexion-invalida': 'Conexión rota',
  'conexion-protocolo-incompatible': 'Conexión no válida',
  'infraestructura-sin-conexion': 'Equipo sin conectar',
  'entidad-desconocida': 'Entidad que no existe',
  'servicio-dominio-incompatible': 'Servicio de otro tipo de entidad',
  'area-desconocida': 'Área que no existe',
  'area-sin-entidades': 'Área sin entidades de ese tipo',
  'zona-solapada': 'Zonas solapadas',
  'zona-sin-coordenadas': 'Zona sin coordenadas',
  'persona-desconocida': 'Persona que no existe',
  'zona-desconocida': 'Zona que no existe',
  'grupo-entidad-desconocida': 'Grupo con entidades que no existen',
  'grupo-dominio-mezclado': 'Grupo con entidades de otro tipo',
  'entity-id-duplicado': 'Nombres de entidad repetidos',
  'dispositivo-sin-sala': 'Dispositivo sin sala',
  'servicio-falta-campo': 'Falta un dato obligatorio',
  'nombre-script-duplicado': 'Scripts con el mismo nombre',
  'helper-no-valido': 'Helper mal configurado',
  'helper-duplicado': 'Helpers con el mismo nombre',
  'patron-hora-no-valido': 'Patrón de hora no válido',
  'opcion-no-valida': 'Opción que no existe',
  'definicion-personalizada-no-valida': 'Dispositivo personalizado con errores',
  'robot-sin-sala': 'Robot sin sala',
  'segmento-sala-desconocida': 'Sala del robot que no existe',
  'asistente-voz-nube': 'Asistente de voz en la nube',
};

/** Título legible de una incidencia (el suyo o, si no lo tiene, el de su código). */
export function issueTitle(issue: Pick<ValidationIssue, 'code' | 'title'>): string {
  return issue.title ?? ISSUE_TITLES[issue.code] ?? 'Revisión necesaria';
}

function issue(severity: IssueSeverity, code: string, message: string, deviceIds: Id[], key = '', ref?: IssueRef): ValidationIssue {
  const suffix = key || deviceIds.join(',');
  const result: ValidationIssue = { id: suffix ? `${code}:${suffix}` : code, severity, code, title: ISSUE_TITLES[code] ?? 'Revisión necesaria', message, deviceIds };
  if (ref) result.ref = ref;
  return result;
}

function names(items: Placed[]): string {
  return items.map((p) => `«${p.device.name}»`).join(', ');
}

function ids(items: Placed[]): Id[] {
  return items.map((p) => p.device.id);
}

function endpoints(ctx: Ctx): Placed[] {
  return ctx.placed.filter((p) => !isInfra(p.def));
}

function unknownDefinitions(ctx: Ctx): ValidationIssue[] {
  return ctx.project.devices
    .filter((d) => !ctx.defs.some((def) => def.id === d.definitionId))
    .map((d) =>
      issue('error', 'definicion-desconocida', `«${d.name}» usa un modelo que no está en el catálogo: cámbialo por uno del catálogo o elimínalo`, [d.id]),
    );
}

function noServer(ctx: Ctx): ValidationIssue[] {
  if (ctx.placed.some((p) => p.def.role === 'ha_server')) return [];
  return [issue('error', 'sin-servidor-ha', 'No hay ningún servidor de Home Assistant en el proyecto', [])];
}

/** Regla genérica: dispositivos que necesitan una infraestructura que no existe. */
function missingInfra(
  ctx: Ctx,
  needs: (p: Placed) => boolean,
  provides: (def: DeviceDefinition) => boolean,
  code: string,
  message: (affected: Placed[]) => string,
  severity: IssueSeverity = 'error',
): ValidationIssue[] {
  const affected = endpoints(ctx).filter(needs);
  if (affected.length === 0 || ctx.placed.some((p) => provides(p.def))) return [];
  return [issue(severity, code, message(affected), ids(affected), code)];
}

function zigbeeRules(ctx: Ctx): ValidationIssue[] {
  const result = missingInfra(
    ctx,
    (p) => p.device.protocol === 'zigbee' && zigbeeNetworkOf(p.device, p.def) === 'coordinator',
    isZigbeeCoordinator,
    'zigbee-sin-coordinador',
    (a) => `Hay dispositivos Zigbee (${names(a)}) pero ningún coordinador Zigbee (p. ej. SONOFF ZBDongle-P)`,
  );
  const coordinators = ctx.placed.filter((p) => isZigbeeCoordinator(p.def));
  if (coordinators.length > 1) {
    result.push(
      issue('warning', 'varios-coordinadores-zigbee', `Hay ${coordinators.length} coordinadores Zigbee (${names(coordinators)}): cada uno crea una red independiente`, ids(coordinators)),
    );
  }
  return result;
}

function hubRules(ctx: Ctx): ValidationIssue[] {
  const byBrand = new Map<Brand, Placed[]>();
  for (const p of endpoints(ctx)) {
    const brand = requiredHubBrand(p.device, p.def);
    if (brand) byBrand.set(brand, [...(byBrand.get(brand) ?? []), p]);
  }
  const result: ValidationIssue[] = [];
  for (const [brand, affected] of byBrand) {
    if (ctx.placed.some((p) => p.def.role === 'hub' && p.def.brand === brand)) continue;
    result.push(
      issue('error', 'falta-hub-propietario', `${names(affected)} necesita${affected.length > 1 ? 'n' : ''} el hub de ${brand} con su integración actual (o cámbia${affected.length > 1 ? 'los' : 'lo'} a ZHA/Zigbee2MQTT)`, ids(affected), brand),
    );
  }
  return result;
}

function simpleInfraRules(ctx: Ctx): ValidationIssue[] {
  return [
    ...missingInfra(ctx, (p) => p.device.protocol === 'thread', isThreadBorderRouter, 'thread-sin-border-router',
      (a) => `Hay dispositivos Thread (${names(a)}) pero ningún border router Thread (Nest Hub, Echo 4.ª gen., Aqara M3, DIRIGERA...)`),
    ...missingInfra(ctx, (p) => p.device.protocol === 'zwave', isZwaveController, 'zwave-sin-controlador',
      (a) => `Hay dispositivos Z-Wave (${names(a)}) pero ningún controlador Z-Wave`),
    ...missingInfra(ctx, (p) => p.device.protocol === 'rf433', isRfBridge, 'rf433-sin-puente',
      (a) => `Hay sensores RF 433 MHz (${names(a)}) pero ningún puente RF (p. ej. SONOFF RF Bridge)`),
  ];
}

/** Marcas cuyos border routers no comparten las credenciales Thread con Home Assistant. */
const CLOSED_THREAD_BRANDS: readonly Brand[] = ['Amazon'];

function threadCredentialsRule(ctx: Ctx): ValidationIssue[] {
  if (!endpoints(ctx).some((p) => p.device.protocol === 'thread')) return [];
  return ctx.placed
    .filter((p) => isThreadBorderRouter(p.def) && CLOSED_THREAD_BRANDS.includes(p.def.brand))
    .map((p) =>
      issue('warning', 'thread-border-router-sin-credenciales', `«${p.device.name}» es border router Thread, pero ${p.def.brand} no comparte las credenciales Thread con Home Assistant: los dispositivos Thread no podrán usar su red desde HA (añade un border router de Google, Aqara, IKEA o uno propio de HA)`, [p.device.id]),
    );
}

function bleWithoutProxy(ctx: Ctx): Placed[] {
  const proxies = ctx.placed.filter((p) => isBleProxy(p.def));
  return endpoints(ctx).filter(
    (p) => p.device.protocol === 'ble' && !proxies.some((x) => isInRange(p.device, x.device, ctx.defs, ctx.project.floors, 'ble')),
  );
}

function bleRule(ctx: Ctx): ValidationIssue[] {
  return bleWithoutProxy(ctx).map((p) =>
    issue('warning', 'ble-sin-proxy', `«${p.device.name}» es Bluetooth LE y no tiene ningún proxy Bluetooth cerca (p. ej. un Shelly Gen2/Gen3 o un ESPHome)`, [p.device.id]),
  );
}

function cloudRule(ctx: Ctx): ValidationIssue[] {
  const groups = new Map<Integration, Placed[]>();
  for (const p of ctx.placed) {
    if (isInfra(p.def) && p.def.role !== 'hub' && p.def.role !== 'border_router') continue;
    if (!isCloud(effectiveIotClass(p.device, p.def))) continue;
    groups.set(p.device.integration, [...(groups.get(p.device.integration) ?? []), p]);
  }
  return [...groups.entries()].map(([integration, items]) => {
    return issue('info', 'integracion-cloud', `La integración ${INTEGRATION_LABELS[integration]} depende de la nube: ${names(items)} dejará${items.length > 1 ? 'n' : ''} de funcionar sin Internet`, ids(items), integration);
  });
}

/** Ids ya señalados por falta de infraestructura (para no duplicar con fuera-de-cobertura). */
function flaggedIds(issues: ValidationIssue[]): Set<Id> {
  const codes = ['zigbee-sin-coordinador', 'falta-hub-propietario', 'thread-sin-border-router', 'zwave-sin-controlador', 'rf433-sin-puente', 'ble-sin-proxy', 'definicion-desconocida'];
  return new Set(issues.filter((i) => codes.includes(i.code)).flatMap((i) => i.deviceIds));
}

function coverageRule(ctx: Ctx, previous: ValidationIssue[]): ValidationIssue[] {
  const mesh = analyzeMesh(ctx.project, ctx.defs);
  const skip = flaggedIds(previous);
  return ctx.placed
    .filter((p) => !mesh.reachable.has(p.device.id) && !skip.has(p.device.id))
    .map((p) =>
      issue('error', 'fuera-de-cobertura', `«${p.device.name}» no alcanza ninguna red: acércalo a un hub, router o punto de acceso, añade un repetidor o conéctalo por cable`, [p.device.id]),
    );
}

function connectionRules(ctx: Ctx): ValidationIssue[] {
  const result: ValidationIssue[] = [];
  for (const c of ctx.project.connections) {
    const a = ctx.project.devices.find((d) => d.id === c.sourceId);
    const b = ctx.project.devices.find((d) => d.id === c.targetId);
    if (!a || !b) {
      result.push(issue('error', 'conexion-invalida', 'Hay una conexión con un dispositivo que ya no existe', [a?.id, b?.id].filter((x): x is Id => x !== undefined), c.id, { kind: 'connection', id: c.id }));
      continue;
    }
    const r = canConnect(a, b, ctx.defs);
    if (!r.ok) {
      result.push(issue('error', 'conexion-protocolo-incompatible', `Conexión «${a.name}» → «${b.name}» no válida: ${r.reason}`, [a.id, b.id], c.id, { kind: 'connection', id: c.id }));
    }
  }
  return result;
}

function isolatedInfraRule(ctx: Ctx): ValidationIssue[] {
  return ctx.placed
    .filter((p) => isInfra(p.def) && p.def.role !== 'ha_server')
    .filter((p) => !ctx.project.connections.some((c) => c.sourceId === p.device.id || c.targetId === p.device.id))
    .map((p) => issue('warning', 'infraestructura-sin-conexion', `«${p.device.name}» no está conectado a la red de casa ni al servidor`, [p.device.id]));
}

const KIND_LABELS: Record<EntityReference['kind'], string> = {
  automation: 'La automatización',
  scene: 'La escena',
  script: 'El script',
};

function knownEntityIds(ctx: Ctx): Set<string> {
  const ids = ctx.placed.flatMap((p) => entityIdsForDevice(p.device, p.def));
  // Fase 3: personas, zonas y grupos también son entidades. Tanda 3: y los helpers.
  return new Set([...ids, ...Object.keys(peopleEntities(ctx.project)), ...(ctx.project.groups ?? []).map(groupEntityId), ...helperEntityIds(ctx.project), ...Object.keys(TTS_ENTITIES)]);
}

function refExists(entityId: string, known: Set<string>, project: Project): boolean {
  if (known.has(entityId)) return true;
  if (entityId.startsWith('scene.')) return findScene(project, entityId) !== undefined;
  if (entityId.startsWith('script.')) return findScript(project, entityId) !== undefined;
  return false;
}

function unknownEntityRule(ctx: Ctx): ValidationIssue[] {
  const known = knownEntityIds(ctx);
  const seen = new Set<string>();
  const result: ValidationIssue[] = [];
  for (const ref of collectEntityRefs(ctx.project)) {
    const key = `${ref.kind}:${ref.ownerId}:${ref.entityId}`;
    if (seen.has(key) || refExists(ref.entityId, known, ctx.project)) continue;
    seen.add(key);
    const shown = ref.entityId === '' ? '(vacía)' : ref.entityId;
    result.push(issue('error', 'entidad-desconocida', `${KIND_LABELS[ref.kind]} «${ref.ownerName}» usa la entidad ${shown}, que no existe`, [], key, { kind: ref.kind, id: ref.ownerId, entityId: ref.entityId }));
  }
  return result;
}

/** Fase 3: personas y zonas de los disparadores/condiciones de zona, y miembros de los grupos. */
const NEUTRAL_SERVICE_DOMAINS = new Set(['homeassistant', 'scene', 'script', 'notify', 'persistent_notification']);

/**
 * Servicios cuyo dominio no es el de la entidad de destino (p. ej. switch.turn_off sobre una
 * luz tras «Mostrar como luz»): HA los rechaza.
 */
function serviceDomainRule(ctx: Ctx): ValidationIssue[] {
  const result: ValidationIssue[] = [];
  const owners: { kind: string; ref: 'automation' | 'script'; id: string; name: string; actions: Action[] }[] = [
    ...ctx.project.automations.map((a) => ({ kind: 'La automatización', ref: 'automation' as const, id: a.id, name: a.name, actions: a.actions })),
    ...ctx.project.scripts.map((s) => ({ kind: 'El script', ref: 'script' as const, id: s.id, name: s.name, actions: s.sequence })),
  ];
  for (const o of owners) {
    for (const a of flattenActions(o.actions)) {
      if (a.type !== 'service' || !a.service.includes('.')) continue;
      const domain = a.service.slice(0, a.service.indexOf('.'));
      // Tanda 1: el destino principal y los adicionales (targets.entityIds).
      for (const entityId of serviceEntityIds(a)) {
        const target = entityId.includes('.') ? entityId.slice(0, entityId.indexOf('.')) : '';
        if (NEUTRAL_SERVICE_DOMAINS.has(domain) || target === '' || domain === target) continue;
        result.push(
          issue('error', 'servicio-dominio-incompatible', `${o.kind} «${o.name}» llama a ${a.service} sobre ${entityId}: el servicio debe ser del dominio ${target}`, [], `${o.id}:${entityId}:${a.service}`, { kind: o.ref, id: o.id, entityId, service: a.service }),
        );
      }
      // Tanda 1: áreas (salas) de destino que no existen o sin entidades del dominio.
      for (const roomId of serviceAreaIds(a)) {
        const room = ctx.project.rooms.find((r) => r.id === roomId);
        if (!room) {
          result.push(issue('error', 'area-desconocida', `${o.kind} «${o.name}» llama a ${a.service} sobre un área que ya no existe`, [], `${o.id}:area:${roomId}`, { kind: o.ref, id: o.id, service: a.service }));
        } else if (areaEntityIds(ctx.project, ctx.defs, roomId, domain).length === 0) {
          result.push(issue('warning', 'area-sin-entidades', `${o.kind} «${o.name}» llama a ${a.service} sobre el área «${room.name}», que no tiene entidades de ese tipo`, [], `${o.id}:area:${roomId}:${a.service}`));
        }
      }
    }
  }
  return result;
}

/** Zonas solapadas (aviso) y sin coordenadas (información). */
function zoneRule(ctx: Ctx): ValidationIssue[] {
  return zoneConflicts(ctx.project).map((c) =>
    c.kind === 'overlap'
      ? issue('warning', 'zona-solapada', c.message, [], c.zoneIds.join(','))
      : issue('info', 'zona-sin-coordenadas', c.message, [], c.zoneIds[0]),
  );
}

function fase3RefsRule(ctx: Ctx): ValidationIssue[] {
  const result: ValidationIssue[] = [];
  const people = new Set((ctx.project.people ?? []).map((p) => p.id));
  const zones = new Set(projectZones(ctx.project).map((z) => z.id));
  const leaves = (c: Condition): Condition[] => (c.type === 'and' || c.type === 'or' || c.type === 'not' ? c.conditions.flatMap(leaves) : [c]);
  for (const a of ctx.project.automations) {
    // También los de las acciones anidadas (wait_for_trigger, condiciones de choose/if/repeat).
    const nested = flattenActions(a.actions);
    const triggers: Trigger[] = [...a.triggers, ...nested.flatMap((x) => (x.type === 'wait_for_trigger' ? x.triggers : []))];
    const refs = [...triggers, ...[...a.conditions, ...nested.flatMap(actionConditions)].flatMap(leaves)];
    for (const r of refs) {
      if (r.type !== 'zone') continue;
      if (!people.has(r.personId)) result.push(issue('error', 'persona-desconocida', `La automatización «${a.name}» usa una persona que ya no existe`, [], `${a.id}:${r.personId}`, { kind: 'automation', id: a.id }));
      if (!zones.has(r.zoneId)) result.push(issue('error', 'zona-desconocida', `La automatización «${a.name}» usa una zona que ya no existe`, [], `${a.id}:${r.zoneId}`, { kind: 'automation', id: a.id }));
    }
  }
  const known = knownEntityIds(ctx);
  for (const g of ctx.project.groups ?? []) {
    const missing = g.entityIds.filter((id) => !known.has(id));
    if (missing.length > 0) result.push(issue('error', 'grupo-entidad-desconocida', `El grupo «${g.name}» incluye entidades que no existen: ${missing.join(', ')}`, [], g.id));
    const wrong = g.entityIds.filter((id) => known.has(id) && g.domain !== 'cover' && !['light', 'switch'].includes(id.split('.')[0] ?? ''));
    const wrongCover = g.entityIds.filter((id) => known.has(id) && g.domain === 'cover' && !id.startsWith('cover.'));
    if (wrong.length + wrongCover.length > 0) {
      result.push(issue('warning', 'grupo-dominio-mezclado', `El grupo «${g.name}» (${GROUP_DOMAIN_LABELS[g.domain]}) incluye entidades de otro tipo: ${[...wrong, ...wrongCover].join(', ')}`, [], `${g.id}:dominio`, { kind: 'group', id: g.id }));
    }
  }
  return result;
}

function duplicateEntityRule(ctx: Ctx): ValidationIssue[] {
  const owners = new Map<string, Id[]>();
  for (const p of ctx.placed) {
    for (const id of new Set(entityIdsForDevice(p.device, p.def))) owners.set(id, [...(owners.get(id) ?? []), p.device.id]);
  }
  const groups = new Map<string, { deviceIds: Id[]; entityIds: string[] }>();
  for (const [entityId, deviceIds] of owners) {
    if (deviceIds.length < 2) continue;
    const key = deviceIds.join(',');
    const group = groups.get(key) ?? { deviceIds, entityIds: [] };
    group.entityIds.push(entityId);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => {
    const devices = g.deviceIds.map((id) => `«${ctx.project.devices.find((d) => d.id === id)?.name ?? id}»`).join(', ');
    return issue('error', 'entity-id-duplicado', `${devices} generan los mismos entity_id (${g.entityIds.join(', ')}); cambia el nombre de alguno`, g.deviceIds);
  });
}

/** Robots aspiradores: sala de la base y salas del mapa (segmentos) que existen. */
function vacuumRules(ctx: Ctx): ValidationIssue[] {
  const result: ValidationIssue[] = [];
  for (const p of ctx.placed) {
    if (p.def.category !== 'vacuum') continue;
    if (!p.device.roomId || !ctx.project.rooms.some((r) => r.id === p.device.roomId)) {
      result.push(issue('warning', 'robot-sin-sala', `«${p.device.name}» no tiene sala asignada: el robot no sabe dónde está su base ni qué salas puede limpiar`, [p.device.id]));
    }
    const unknown = unknownVacuumRooms(ctx.project, p.device);
    if (unknown.length > 0) {
      result.push(issue('error', 'segmento-sala-desconocida', `«${p.device.name}» tiene en su mapa ${unknown.length === 1 ? 'una sala que ya no existe' : `${unknown.length} salas que ya no existen`}: revisa «Mapa del robot» en Propiedades`, [p.device.id]));
    }
  }
  // vacuum.clean_area con áreas que no existen.
  for (const a of ctx.project.automations) {
    for (const x of flattenActions(a.actions)) {
      if (x.type !== 'service' || x.service !== 'vacuum.clean_area') continue;
      const missing = parseAreaIds(x.data?.cleaning_area_id).filter((id) => !ctx.project.rooms.some((r) => r.id === id));
      if (missing.length > 0) {
        result.push(issue('error', 'segmento-sala-desconocida', `La automatización «${a.name}» manda limpiar ${missing.length === 1 ? 'un área que no existe' : `${missing.length} áreas que no existen`} (${missing.join(', ')})`, [], `${a.id}:${missing.join(',')}`, { kind: 'automation', id: a.id }));
      }
    }
  }
  return result;
}

/** Alexa y Google (y Siri) dependen de Internet: sin conexión no entienden nada. */
function cloudAssistantRule(ctx: Ctx): ValidationIssue[] {
  const groups = new Map<string, Placed[]>();
  for (const p of ctx.placed) {
    if (p.def.assistant?.pipeline !== 'cloud') continue;
    groups.set(p.def.assistant.kind, [...(groups.get(p.def.assistant.kind) ?? []), p]);
  }
  const NAMES: Record<string, string> = { alexa: 'Alexa', google: 'Google Assistant', siri: 'Siri' };
  return [...groups.entries()].map(([kind, items]) =>
    issue('info', 'asistente-voz-nube', `${NAMES[kind] ?? kind} funciona en la nube: sin Internet, ${names(items)} no ${items.length > 1 ? 'entienden' : 'entiende'} ninguna orden de voz (Assist con HA Voice o Wyoming sí es local)`, ids(items), kind),
  );
}

function roomRule(ctx: Ctx): ValidationIssue[] {
  return ctx.project.devices
    .filter((d) => !d.roomId || !ctx.project.rooms.some((r) => r.id === d.roomId))
    .map((d) => issue('info', 'dispositivo-sin-sala', `«${d.name}» no está asignado a ninguna sala`, [d.id]));
}

function missingFieldRule(ctx: Ctx): ValidationIssue[] {
  const result: ValidationIssue[] = [];
  const check = (kind: EntityReference['kind'], ownerId: string, ownerName: string, actions: Action[]): void => {
    actions.forEach((top, i) => {
      // La acción de primer nivel y las anidadas (choose/if/repeat) cuentan como «acción i + 1».
      flattenActions([top]).forEach((a, j) => {
        if (a.type !== 'service') return;
        for (const f of missingRequiredFields(a.service, a.data)) {
          const key = j === 0 ? `${kind}:${ownerId}:${i}:${f.key}` : `${kind}:${ownerId}:${i}.${j}:${f.key}`;
          result.push(
            issue('error', 'servicio-falta-campo', `${KIND_LABELS[kind]} «${ownerName}» llama a ${a.service} (acción ${i + 1}) sin el campo obligatorio «${f.label}» (${f.key})`, [], key),
          );
        }
      });
    });
  };
  for (const a of ctx.project.automations) check('automation', a.id, a.name, a.actions);
  for (const s of ctx.project.scripts) check('script', s.id, s.name, s.sequence);
  return result;
}

function duplicateScriptNameRule(ctx: Ctx): ValidationIssue[] {
  const groups = new Map<string, string[]>();
  const scriptIds = new Map<string, Id[]>();
  for (const s of ctx.project.scripts) {
    const slug = slugify(s.name);
    groups.set(slug, [...(groups.get(slug) ?? []), s.name]);
    scriptIds.set(slug, [...(scriptIds.get(slug) ?? []), s.id]);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([slug, list]) => ({ slug, list, ids: scriptIds.get(slug) ?? [] }))
    .map(({ slug, list, ids }) =>
      issue('warning', 'nombre-script-duplicado', `Hay ${list.length} scripts con el mismo nombre (${list.map((n) => `«${n}»`).join(', ')}): sus entity_id serán script.${slug}, script.${slug}_2...; cámbiales el nombre para distinguirlos`, [], slug, { kind: 'script', id: ids[0] ?? '', slug }),
    );
}

/** Tanda 3: helpers, patrones de hora, opciones de input_select y dispositivos personalizados. */
function tanda3Rules(ctx: Ctx): ValidationIssue[] {
  const result: ValidationIssue[] = [];
  const helpers = ctx.project.helpers ?? [];
  for (const h of helpers) {
    const errors = validateHelper(h);
    if (errors.length > 0) result.push(issue('error', 'helper-no-valido', `El helper «${h.name}»: ${errors.join('; ')}`, [], h.id));
  }
  const byEntity = new Map<string, string[]>();
  for (const h of helpers) byEntity.set(helperEntityId(h), [...(byEntity.get(helperEntityId(h)) ?? []), h.name]);
  for (const [entityId, list] of byEntity) {
    if (list.length > 1) result.push(issue('error', 'helper-duplicado', `Hay ${list.length} helpers que generan ${entityId} (${list.map((n) => `«${n}»`).join(', ')}): cambia el nombre de alguno`, [], entityId));
  }
  const owners = [
    ...ctx.project.automations.map((a) => ({ kind: 'La automatización', ref: 'automation' as const, id: a.id, name: a.name, triggers: a.triggers, actions: a.actions })),
    ...ctx.project.scripts.map((s) => ({ kind: 'El script', ref: 'script' as const, id: s.id, name: s.name, triggers: [] as Trigger[], actions: s.sequence })),
  ];
  for (const o of owners) {
    const nested = flattenActions(o.actions);
    const triggers = [...o.triggers, ...nested.flatMap((x) => (x.type === 'wait_for_trigger' ? x.triggers : []))];
    triggers.forEach((t, i) => {
      if (t.type === 'time_pattern' && !timePatternSets(t)) {
        result.push(issue('error', 'patron-hora-no-valido', `${o.kind} «${o.name}» tiene un patrón de hora no válido (usa un número, * o /N en horas 0-23, minutos y segundos 0-59)`, [], `${o.id}:${i}`, { kind: o.ref, id: o.id }));
      }
    });
    for (const a of nested) {
      if (a.type !== 'service' || a.service !== 'input_select.select_option') continue;
      const option = a.data?.option;
      const h = helpers.find((x) => helperEntityId(x) === a.entityId);
      if (h?.type === 'input_select' && option !== undefined && !String(option).includes('{{') && !h.options.includes(String(option))) {
        result.push(issue('warning', 'opcion-no-valida', `${o.kind} «${o.name}» elige la opción «${String(option)}», que no está en «${h.name}» (${h.options.join(', ')})`, [], `${o.id}:${a.entityId}:${String(option)}`, { kind: o.ref, id: o.id, entityId: a.entityId }));
      }
    }
  }
  for (const def of ctx.project.customDefinitions ?? []) {
    const errors = validateDefinition(def);
    if (errors.length > 0) {
      const used = ctx.project.devices.filter((d) => d.definitionId === def.id).map((d) => d.id);
      result.push(issue('error', 'definicion-personalizada-no-valida', `El dispositivo personalizado «${def.name}»: ${errors.join('; ')}`, used, def.id));
    }
  }
  return result;
}

const GROUP_DOMAIN_LABELS: Record<'light' | 'switch' | 'cover', string> = { light: 'luces', switch: 'interruptores', cover: 'persianas' };

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Valida el proyecto. Devuelve los problemas ordenados por gravedad (errores primero). */
export function validateProject(project: Project, baseDefs: DeviceDefinition[]): ValidationIssue[] {
  // Tanda 3: el catálogo recibido más los dispositivos personalizados del proyecto.
  const defs = allDefinitions(project, baseDefs);
  const placed: Placed[] = [];
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (def) placed.push({ device, def });
  }
  const ctx: Ctx = { project, defs, placed };
  const issues = [
    ...unknownDefinitions(ctx),
    ...noServer(ctx),
    ...zigbeeRules(ctx),
    ...hubRules(ctx),
    ...simpleInfraRules(ctx),
    ...bleRule(ctx),
    ...threadCredentialsRule(ctx),
  ];
  issues.push(...coverageRule(ctx, issues));
  issues.push(
    ...connectionRules(ctx),
    ...duplicateEntityRule(ctx),
    ...unknownEntityRule(ctx),
    ...fase3RefsRule(ctx),
    ...serviceDomainRule(ctx),
    ...zoneRule(ctx),
    ...missingFieldRule(ctx),
    ...duplicateScriptNameRule(ctx),
    ...tanda3Rules(ctx),
    ...isolatedInfraRule(ctx),
    ...cloudRule(ctx),
    ...cloudAssistantRule(ctx),
    ...vacuumRules(ctx),
    ...roomRule(ctx),
  );
  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
