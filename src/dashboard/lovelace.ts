// Dashboard tipo Lovelace (B15): una vista por planta, una sección por sala y tarjetas según el
// dominio de cada entidad. dashboardToYaml produce YAML válido para el modo YAML de Lovelace.
import type { DeviceDefinition, Floor, Id, Project } from '../types';
import { entitiesForDevice, entityDomain, slugify } from '../devices/entities';
import { entityRoomMap } from '../devices/areas';
import { groupEntityId, personEntityId } from '../simulation/logic';
import { toYaml, type YamlMap, type YamlValue } from '../export/yaml';

export type DashboardCard =
  | { type: 'heading'; heading: string }
  | { type: 'tile'; entity: string; name?: string }
  | { type: 'entities'; title?: string; entities: string[] }
  | { type: 'thermostat'; entity: string }
  | { type: 'media-control'; entity: string }
  | { type: 'picture-glance'; title?: string; camera_image: string; entities: string[] };

export interface DashboardSection {
  type: 'grid';
  /** Sala de la sección (undefined: sin sala / personas). */
  roomId?: Id;
  cards: DashboardCard[];
}

export interface DashboardView {
  title: string;
  path: string;
  /** Planta de la vista. */
  floorId?: Id;
  type: 'sections';
  sections: DashboardSection[];
}

export interface Dashboard {
  title: string;
  views: DashboardView[];
}

/** Dominios que se muestran como tarjeta tile (controlables). */
const TILE_DOMAINS = new Set(['light', 'switch', 'cover', 'lock', 'fan', 'vacuum', 'button']);

interface EntityInfo {
  entityId: string;
  deviceId: Id;
  name: string;
  /** Nombre del dispositivo (título de la tarjeta de cámara, sin repetir «Cámara»). */
  deviceName: string;
}

function roomCards(entities: EntityInfo[], groups: string[]): DashboardCard[] {
  const cards: DashboardCard[] = [];
  const listed: string[] = [];
  const usedByCamera = new Set<string>();
  for (const e of entities) {
    if (entityDomain(e.entityId) !== 'camera') continue;
    const siblings = entities.filter((x) => x.deviceId === e.deviceId && x.entityId !== e.entityId).map((x) => x.entityId);
    siblings.forEach((s) => usedByCamera.add(s));
    cards.push({ type: 'picture-glance', title: e.deviceName, camera_image: e.entityId, entities: siblings });
  }
  for (const id of groups) cards.push({ type: 'tile', entity: id });
  for (const e of entities) {
    const domain = entityDomain(e.entityId);
    if (domain === 'camera' || usedByCamera.has(e.entityId)) continue;
    if (domain === 'climate') cards.push({ type: 'thermostat', entity: e.entityId });
    else if (domain === 'media_player') cards.push({ type: 'media-control', entity: e.entityId });
    else if (TILE_DOMAINS.has(domain)) cards.push({ type: 'tile', entity: e.entityId });
    // sensores, binary_sensor y el resto van juntos en la tarjeta entities de la sala
    else listed.push(e.entityId);
  }
  if (listed.length > 0) cards.push({ type: 'entities', title: 'Sensores', entities: listed });
  return cards;
}

function viewPath(floor: Floor, used: Set<string>): string {
  const base = slugify(floor.name).replace(/_/g, '-');
  let path = base;
  for (let n = 2; used.has(path); n++) path = `${base}-${n}`;
  used.add(path);
  return path;
}

/**
 * Genera el dashboard: una vista por planta (ordenadas por nivel), una sección por sala con
 * encabezado y tarjetas (tile, entities, thermostat, media-control, picture-glance), una sección
 * «Sin sala» para los dispositivos sin sala y una sección «Personas» en la primera vista.
 * La infraestructura sin entidades no aparece.
 */
export function generateDashboard(project: Project, defs: DeviceDefinition[]): Dashboard {
  const roomOf = entityRoomMap(project, defs);
  const floors = [...project.floors].sort((a, b) => a.level - b.level);
  const usedPaths = new Set<string>();
  const views: DashboardView[] = floors.map((floor) => {
    const sections: DashboardSection[] = [];
    const devices = project.devices.filter((d) => d.floorId === floor.id);
    const infos = (filter: (roomId: Id | undefined) => boolean): EntityInfo[] =>
      devices
        .filter((d) => filter(d.roomId && project.rooms.some((r) => r.id === d.roomId) ? d.roomId : undefined))
        .flatMap((d) => {
          const def = defs.find((x) => x.id === d.definitionId);
          return def ? entitiesForDevice(d, def).map((e) => ({ entityId: e.entityId, deviceId: d.id, name: e.friendlyName, deviceName: d.name })) : [];
        });
    for (const room of project.rooms.filter((r) => r.floorId === floor.id)) {
      const groups = (project.groups ?? []).map(groupEntityId).filter((id) => roomOf[id] === room.id);
      const cards = roomCards(infos((r) => r === room.id), groups);
      if (cards.length > 0) sections.push({ type: 'grid', roomId: room.id, cards: [{ type: 'heading', heading: room.name }, ...cards] });
    }
    const loose = roomCards(infos((r) => r === undefined), []);
    if (loose.length > 0) sections.push({ type: 'grid', cards: [{ type: 'heading', heading: 'Sin sala' }, ...loose] });
    return { title: floor.name, path: viewPath(floor, usedPaths), floorId: floor.id, type: 'sections', sections };
  });
  const people = project.people ?? [];
  const first = views[0];
  if (first && people.length > 0) {
    first.sections.unshift({ type: 'grid', cards: [{ type: 'heading', heading: 'Personas' }, ...people.map((p): DashboardCard => ({ type: 'tile', entity: personEntityId(p) }))] });
  }
  const groupsWithoutRoom = (project.groups ?? []).map(groupEntityId).filter((id) => roomOf[id] === undefined);
  if (first && groupsWithoutRoom.length > 0) {
    first.sections.push({ type: 'grid', cards: [{ type: 'heading', heading: 'Grupos' }, ...groupsWithoutRoom.map((id): DashboardCard => ({ type: 'tile', entity: id }))] });
  }
  return { title: project.name, views };
}

function cardToYaml(card: DashboardCard): YamlMap {
  const m: YamlMap = {};
  for (const [k, v] of Object.entries(card)) {
    if (v === undefined) continue;
    m[k] = Array.isArray(v) ? (v as string[]) : (v as YamlValue);
  }
  return m;
}

/** YAML del dashboard (modo YAML de Lovelace: ui-lovelace.yaml o un dashboard en YAML). */
export function dashboardToYaml(dashboard: Dashboard): string {
  return toYaml({
    title: dashboard.title,
    views: dashboard.views.map((v) => ({
      title: v.title,
      path: v.path,
      type: v.type,
      sections: v.sections.map((s) => ({ type: s.type, cards: s.cards.map(cardToYaml) })),
    })),
  });
}

/** Número de tarjetas (sin encabezados) del dashboard. */
export function countCards(dashboard: Dashboard): number {
  return dashboard.views.reduce((acc, v) => acc + v.sections.reduce((a, s) => a + s.cards.filter((c) => c.type !== 'heading').length, 0), 0);
}
