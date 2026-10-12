// Lógica pura de la Fase 3 que usa el motor: personas y zonas, grupos, notificaciones,
// variables y expansión de acciones de control (choose, if, repeat). No importa engine.ts.
import type {
  EntityGroup,
  EntityState,
  EntityStateValue,
  Id,
  Person,
  Project,
  SimNotification,
  SimulationState,
  Trigger,
  Zone,
} from '../types';
import { entityDomain, slugify } from '../devices/entities';
import { HOME_ZONE_ID, personRef, zoneRef } from '../export/yamlLogic';

export { HOME_ZONE_ID } from '../export/yamlLogic';

/** Estado de una persona fuera de todas las zonas. */
export const NOT_HOME = 'not_home';
/** Notificaciones máximas en la bandeja (se conservan las más recientes). */
export const MAX_NOTIFICATIONS = 100;
/** Pasos máximos de acciones sin espera en una misma ejecución (protege de repeat infinitos). */
export const MAX_ACTION_STEPS = 10_000;
/** dueAt de una espera sin tiempo límite. */
export const WAIT_FOREVER = Number.MAX_SAFE_INTEGER;

// ---------- Personas y zonas ----------

const HOME_ZONE: Zone = { id: HOME_ZONE_ID, name: 'Casa', kind: 'home' };

/** Zonas del proyecto; si no define ninguna de tipo home, se añade la zona «Casa» implícita (id «home»). */
export function projectZones(project: Pick<Project, 'zones'>): Zone[] {
  const zones = project.zones ?? [];
  return zones.some((z) => z.kind === 'home') ? zones : [HOME_ZONE, ...zones];
}

export function findZone(project: Pick<Project, 'zones'>, zoneId: Id): Zone | undefined {
  return projectZones(project).find((z) => z.id === zoneId);
}

export function personEntityId(person: Person): string {
  return personRef(person.id, { people: [person] });
}

export function zoneEntityId(zone: Zone): string {
  return zoneRef(zone.id, { zones: [zone] });
}

/** Estado de una persona dentro de la zona: 'home' para casa, el nombre para las demás. */
export function zoneStateName(zone: Zone): string {
  return zone.kind === 'home' ? 'home' : zone.name;
}

/** Zona en la que está una persona según su entidad (undefined si fuera de todas). */
export function personZoneId(sim: SimulationState, personId: Id): Id | undefined {
  const st = Object.entries(sim.entities).find(([id, e]) => entityDomain(id) === 'person' && e.attributes?.person_id === personId)?.[1];
  const zoneId = st?.attributes?.zone_id;
  return zoneId === undefined || zoneId === '' ? undefined : String(zoneId);
}

/**
 * Entidades iniciales de personas y zonas: person.<slug> (en casa al empezar) y zone.<slug>
 * con el número de personas dentro (zone.home siempre existe).
 */
export function peopleEntities(project: Pick<Project, 'people' | 'zones'>): Record<string, EntityState> {
  const people = project.people ?? [];
  const zones = projectZones(project);
  const home = zones.find((z) => z.kind === 'home') ?? HOME_ZONE;
  const result: Record<string, EntityState> = {};
  for (const p of people) {
    const attributes: Record<string, EntityStateValue> = { friendly_name: p.name, person_id: p.id, zone_id: home.id };
    if (p.color !== undefined) attributes.color = p.color;
    result[personEntityId(p)] = { state: 'home', attributes };
  }
  for (const z of zones) {
    result[zoneEntityId(z)] = {
      state: z.kind === 'home' ? people.length : 0,
      attributes: { friendly_name: z.name, zone_id: z.id, kind: z.kind, unit_of_measurement: 'personas' },
    };
  }
  return result;
}

/** Número de personas por zona según los estados de las personas. */
export function zoneCounts(project: Pick<Project, 'people' | 'zones'>, entities: Record<string, EntityState>): Record<Id, number> {
  const counts: Record<Id, number> = {};
  for (const z of projectZones(project)) counts[z.id] = 0;
  for (const p of project.people ?? []) {
    const zoneId = entities[personEntityId(p)]?.attributes?.zone_id;
    if (zoneId !== undefined && zoneId !== '' && counts[String(zoneId)] !== undefined) counts[String(zoneId)] = (counts[String(zoneId)] ?? 0) + 1;
  }
  return counts;
}

function same(a: EntityStateValue, b: EntityStateValue): boolean {
  const n = (v: EntityStateValue): string => (v === true ? 'on' : v === false ? 'off' : String(v));
  return n(a) === n(b);
}

/**
 * ¿Coincide un disparador de la Fase 3 (zone, device_action) con un cambio de estado?
 * Para el resto de tipos devuelve false (los evalúa el motor).
 */
export function fase3TriggerMatches(
  t: Trigger,
  project: Pick<Project, 'people' | 'zones'>,
  entityId: string,
  prev: EntityStateValue,
  next: EntityStateValue,
): boolean {
  if (t.type === 'device_action') return t.entityId === entityId && !same(prev, next) && same(next, t.action);
  if (t.type !== 'zone') return false;
  const person = project.people?.find((p) => p.id === t.personId);
  const zone = findZone(project, t.zoneId);
  if (!person || !zone || personEntityId(person) !== entityId) return false;
  const name = zoneStateName(zone);
  return t.event === 'enter' ? same(next, name) && !same(prev, name) : same(prev, name) && !same(next, name);
}

// ---------- Grupos ----------

/** entity_id del grupo: <dominio>.grupo_<slug> (sin duplicar el prefijo «grupo»). */
export function groupEntityId(group: Pick<EntityGroup, 'domain' | 'name'>): string {
  return `${group.domain}.${slugify(groupHaName(group))}`;
}

/**
 * Nombre con el que se exporta el grupo a HA: HA crea el entity_id a partir de `name`, así que
 * slugify(groupHaName(g)) es siempre el objeto de groupEntityId(g). Se antepone «Grupo» salvo
 * que el nombre ya empiece por esa palabra.
 */
export function groupHaName(group: Pick<EntityGroup, 'name'>): string {
  const name = group.name.trim();
  const slug = slugify(name);
  if (name !== '' && (slug === 'grupo' || slug.startsWith('grupo_'))) return name;
  return `Grupo ${name === '' ? 'sin nombre' : name}`;
}

export function findGroupByEntity(project: Pick<Project, 'groups'>, entityId: string): EntityGroup | undefined {
  return project.groups?.find((g) => groupEntityId(g) === entityId);
}

export function groupsContaining(project: Pick<Project, 'groups'>, entityId: string): EntityGroup[] {
  return (project.groups ?? []).filter((g) => g.entityIds.includes(entityId));
}

const ON_STATES = new Set(['on', 'open', 'opening', 'closing', 'playing']);

/**
 * Estado agregado de un grupo: luz/interruptor 'on' si alguno está encendido; persiana 'open'
 * si alguna está abierta (o moviéndose). 'unavailable' si ningún miembro está disponible.
 */
export function aggregateGroupState(group: EntityGroup, entities: Record<string, EntityState>): EntityState {
  const members = group.entityIds.map((id) => entities[id]).filter((e): e is EntityState => e !== undefined);
  const available = members.filter((m) => m.state !== 'unavailable');
  const attributes: Record<string, EntityStateValue> = { friendly_name: group.name, entity_id: group.entityIds.join(', '), group_id: group.id };
  if (available.length === 0) return { state: 'unavailable', attributes };
  const anyOn = available.some((m) => ON_STATES.has(String(m.state === true ? 'on' : m.state)));
  if (group.domain === 'cover') return { state: anyOn ? 'open' : 'closed', attributes };
  return { state: anyOn ? 'on' : 'off', attributes };
}

/** Entidades iniciales de los grupos, calculadas a partir de las de sus miembros. */
export function groupEntities(project: Pick<Project, 'groups'>, entities: Record<string, EntityState>): Record<string, EntityState> {
  const result: Record<string, EntityState> = {};
  for (const g of project.groups ?? []) result[groupEntityId(g)] = aggregateGroupState(g, entities);
  return result;
}

/**
 * Servicio que se llama en cada miembro de un grupo. toggle se resuelve con el estado del
 * grupo (como HA: si está encendido, se apaga todo). Si el dominio del miembro no es el del
 * grupo, se usa homeassistant.<servicio>.
 */
export function memberService(group: EntityGroup, groupState: EntityStateValue, service: string, memberId: string): string {
  let svc = service;
  if (svc === 'toggle') svc = group.domain === 'cover' ? (ON_STATES.has(String(groupState)) ? 'close_cover' : 'open_cover') : ON_STATES.has(String(groupState)) ? 'turn_off' : 'turn_on';
  const domain = entityDomain(memberId);
  return domain === group.domain || group.domain === 'cover' ? `${domain}.${svc}` : `homeassistant.${svc}`;
}

// ---------- Notificaciones ----------

function nextNotificationSeq(list: SimNotification[]): number {
  const last = list[list.length - 1];
  const n = last ? Number(last.id.replace(/^notif-/, '')) : 0;
  return Number.isFinite(n) ? n + 1 : list.length + 1;
}

export function addNotification(sim: SimulationState, title: string, message: string): SimulationState {
  const list = sim.notifications ?? [];
  const entry: SimNotification = { id: `notif-${nextNotificationSeq(list)}`, at: sim.now, title, message, read: false };
  const next = [...list, entry];
  return { ...sim, notifications: next.length > MAX_NOTIFICATIONS ? next.slice(next.length - MAX_NOTIFICATIONS) : next };
}

export function markNotificationRead(sim: SimulationState, id: Id, read = true): SimulationState {
  if (!sim.notifications?.some((n) => n.id === id)) return sim;
  return { ...sim, notifications: sim.notifications.map((n) => (n.id === id ? { ...n, read } : n)) };
}

export function markAllNotificationsRead(sim: SimulationState): SimulationState {
  if (!sim.notifications?.some((n) => !n.read)) return sim;
  return { ...sim, notifications: sim.notifications.map((n) => ({ ...n, read: true })) };
}

export function dismissNotification(sim: SimulationState, id: Id): SimulationState {
  if (!sim.notifications?.some((n) => n.id === id)) return sim;
  return { ...sim, notifications: sim.notifications.filter((n) => n.id !== id) };
}

export function clearNotifications(sim: SimulationState): SimulationState {
  return sim.notifications && sim.notifications.length > 0 ? { ...sim, notifications: [] } : sim;
}

export function unreadNotifications(sim: SimulationState): number {
  return (sim.notifications ?? []).filter((n) => !n.read).length;
}

// ---------- Variables y plantillas ----------

export type Variables = Record<string, EntityStateValue>;

const TEMPLATE = /\{\{\s*([^}]*?)\s*\}\}/g;
const STATES_CALL = /^states\(\s*['"]([^'"]+)['"]\s*\)$/;
const ATTR_CALL = /^state_attr\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)$/;

function stringify(v: EntityStateValue): string {
  return v === true ? 'on' : v === false ? 'off' : String(v);
}

/**
 * Sustituye {{ variable }}, {{ states('entity_id') }} y {{ state_attr('entity_id', 'attr') }}.
 * Lo que no se reconoce se deja tal cual.
 */
export function renderTemplate(text: string, vars: Variables = {}, sim?: Pick<SimulationState, 'entities'>): string {
  return text.replace(TEMPLATE, (whole, expr: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, expr)) return stringify(vars[expr] ?? '');
    const st = STATES_CALL.exec(expr);
    if (st?.[1] !== undefined && sim) {
      const e = sim.entities[st[1]];
      return e ? stringify(e.state) : 'unknown';
    }
    const at = ATTR_CALL.exec(expr);
    if (at?.[1] !== undefined && at[2] !== undefined && sim) {
      const v = sim.entities[at[1]]?.attributes?.[at[2]];
      return v === undefined ? 'None' : stringify(v);
    }
    return whole;
  });
}

/** Datos de servicio con plantillas resueltas (un texto que queda numérico pasa a número). */
export function renderData(
  data: Record<string, EntityStateValue> | undefined,
  vars: Variables,
  sim: Pick<SimulationState, 'entities'>,
): Record<string, EntityStateValue> | undefined {
  if (!data) return data;
  let changed = false;
  const out: Record<string, EntityStateValue> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v !== 'string' || !v.includes('{{')) {
      out[k] = v;
      continue;
    }
    const text = renderTemplate(v, vars, sim);
    const n = Number(text);
    out[k] = text.trim() !== '' && Number.isFinite(n) ? n : text;
    changed = true;
  }
  return changed ? out : data;
}

