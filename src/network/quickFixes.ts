// Arreglos rápidos de las incidencias del validador (Tanda 2). Funciones puras e inmutables:
// cada arreglo recibe el proyecto y devuelve uno nuevo; la interfaz solo los ofrece y aplica.
import type {
  Action,
  Automation,
  Brand,
  Condition,
  Connection,
  Device,
  DeviceDefinition,
  Id,
  Integration,
  Point,
  Project,
  Room,
  Script,
  ServiceAction,
  Trigger,
  ValidationIssue,
} from '../types';
import { createDevice, uniqueDeviceName } from '../devices/factory';
import { entitiesForDevice, slugify } from '../devices/entities';
import { INTEGRATION_LABELS } from '../devices/labels';
import { HUB_FOR_BRAND, isInfra, isZigbeeCoordinator, requiredHubBrand, ZIGBEE_COORDINATOR_INTEGRATIONS } from '../devices/roles';
import { renameEntityRefs } from '../devices/renaming';
import { groupEntityId, peopleEntities } from '../simulation/logic';
import { serviceInfo } from '../simulation/serviceCatalog';
import { NODE_SIZE, placeNewDevices, roomAt } from '../canvas/placement';
import { polygonBounds, resolveRoomId } from '../canvas/geometry';
import { canConnect, isWiredLink, suggestConnections } from './connections';
import { analyzeMesh } from './mesh';
import { allDefinitions } from '../devices/catalog';

export interface QuickFix {
  /** Id estable del arreglo (`<id de la incidencia>#<arreglo>`). */
  id: string;
  /** Texto del botón, en español. */
  label: string;
  /** Aplica el arreglo y devuelve el proyecto nuevo (no muta el recibido). */
  apply(project: Project): Project;
  /** Dispositivos que conviene seleccionar después (los añadidos o movidos). */
  selectAfter?: Id[];
}

// ---------- Utilidades ----------

interface Placed {
  device: Device;
  def: DeviceDefinition;
}

function placed(project: Project, defs: DeviceDefinition[]): Placed[] {
  defs = allDefinitions(project, defs);
  const out: Placed[] = [];
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (def) out.push({ device, def });
  }
  return out;
}

function affectedDevices(issue: ValidationIssue, project: Project, defs: DeviceDefinition[]): Placed[] {
  return placed(project, defs).filter((p) => issue.deviceIds.includes(p.device.id));
}

const newId = (): Id => crypto.randomUUID();

/** Nombres cortos para la infraestructura que se añade. */
const INFRA_NAMES: Record<Id, string> = {
  'ha-green': 'Home Assistant',
  'sonoff-zbdongle-p': 'Coordinador Zigbee',
  'ha-connect-zwa-2': 'Controlador Z-Wave',
  'google-nest-hub-2': 'Border router Thread',
  'sonoff-rf-bridge-r2': 'Puente RF',
  'shelly-1pm-gen3': 'Proxy Bluetooth',
  'hue-bridge-v2': 'Puente Hue',
  'aqara-hub-m2': 'Hub Aqara',
  'ikea-dirigera': 'Hub IKEA',
};

function sortedFloors(project: Project): Id[] {
  return [...project.floors].sort((a, b) => a.level - b.level).map((f) => f.id);
}

/** Sala y planta donde colocar infraestructura: la del servidor HA, la de los afectados o la primera. */
function infraSpot(project: Project, defs: DeviceDefinition[], near?: Device): { floorId: Id; roomId?: Id } | undefined {
  const server = placed(project, defs).find((p) => p.def.role === 'ha_server')?.device;
  const anchor = near ?? server;
  if (anchor) return anchor.roomId ? { floorId: anchor.floorId, roomId: anchor.roomId } : { floorId: anchor.floorId };
  const floorId = sortedFloors(project)[0];
  if (!floorId) return undefined;
  const room = project.rooms.find((r) => r.floorId === floorId);
  return room ? { floorId, roomId: room.id } : { floorId };
}

/** Conexiones sugeridas en las que participa alguno de los dispositivos. */
function connectionsFor(project: Project, defs: DeviceDefinition[], ids: readonly Id[]): Connection[] {
  return suggestConnections(project, defs).filter((c) => ids.includes(c.sourceId) || ids.includes(c.targetId));
}

function withConnections(project: Project, connections: Connection[]): Project {
  return connections.length === 0 ? project : { ...project, connections: [...project.connections, ...connections] };
}

/**
 * Añade un equipo del catálogo colocado con placeNewDevices (en la sala indicada) y lo conecta
 * con él y con los dispositivos `alsoConnect`.
 */
function addDevice(
  project: Project,
  defs: DeviceDefinition[],
  definitionId: Id,
  id: Id,
  where: { floorId: Id; roomId?: Id; near?: Point },
  alsoConnect: readonly Id[] = [],
): Project {
  const def = defs.find((d) => d.id === definitionId);
  if (!def || !project.floors.some((f) => f.id === where.floorId)) return project;
  const first = placeDevice(project, defs, def, definitionId, id, where, alsoConnect);
  if (first.device.roomId && first.connected) return first.project;
  // Sin sala (p. ej. el servidor no está en ninguna): se prueba en la sala más cercana de esa
  // planta y luego en las de las demás, y se queda con la primera que lo deja en una sala y
  // conectado; así el arreglo no crea incidencias nuevas.
  const anchor = where.near ?? project.devices.find((d) => d.floorId === where.floorId)?.position ?? { x: 0, y: 0 };
  const candidates = [
    ...project.rooms.filter((r) => r.floorId === where.floorId && r.polygon.length >= 3).sort((a, b) => roomDistance(a, anchor) - roomDistance(b, anchor)),
    ...sortedFloors(project).flatMap((f) => (f === where.floorId ? [] : project.rooms.filter((r) => r.floorId === f && r.polygon.length >= 3))),
  ];
  for (const room of candidates) {
    const attempt = placeDevice(project, defs, def, definitionId, id, { floorId: room.floorId, roomId: room.id }, alsoConnect);
    if (attempt.device.roomId && attempt.connected) return attempt.project;
  }
  return first.project;
}

/** Coloca y conecta el equipo en `where`; dice si ha quedado conectado. */
function placeDevice(
  project: Project,
  defs: DeviceDefinition[],
  def: DeviceDefinition,
  definitionId: Id,
  id: Id,
  where: { floorId: Id; roomId?: Id; near?: Point },
  alsoConnect: readonly Id[],
): { project: Project; device: Device; connected: boolean } {
  const opts: { roomId?: Id; near?: Point } = {};
  if (where.roomId) opts.roomId = where.roomId;
  if (where.near) opts.near = where.near;
  const [position = { x: 0, y: 0 }] = placeNewDevices(project, where.floorId, 1, opts);
  const name = uniqueDeviceName(INFRA_NAMES[definitionId] ?? def.name, project.devices);
  const created = createDevice(def, { floorId: where.floorId, position, name }, project, defs);
  const roomId = roomAt(project, where.floorId, position)?.id ?? where.roomId;
  const device: Device = { ...created, id };
  if (roomId) device.roomId = roomId;
  else delete device.roomId;
  const next: Project = { ...project, devices: [...project.devices, device] };
  const connections = connectionsFor(next, defs, [id, ...alsoConnect]);
  const connected = connections.some((c) => c.sourceId === id || c.targetId === id);
  return { project: withConnections(next, connections), device, connected };
}

/** Distancia de un punto al rectángulo que envuelve una sala (0 si está dentro). */
function roomDistance(r: Room, point: Point): number {
  const b = polygonBounds(r.polygon);
  const dx = Math.max(b.x - point.x, 0, point.x - (b.x + b.width));
  const dy = Math.max(b.y - point.y, 0, point.y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

function updateDevices(project: Project, ids: readonly Id[], patch: (d: Device) => Device): Project {
  return { ...project, devices: project.devices.map((d) => (ids.includes(d.id) ? patch(d) : d)) };
}

/** Centro del nodo de un dispositivo. */
const centerOf = (d: Device): Point => ({ x: d.position.x + NODE_SIZE.width / 2, y: d.position.y + NODE_SIZE.height / 2 });

// ---------- Infraestructura que falta ----------

function addInfraFix(
  issue: ValidationIssue,
  project: Project,
  defs: DeviceDefinition[],
  definitionId: Id,
  label: string,
  nearAffected: boolean,
): QuickFix | undefined {
  const def = defs.find((d) => d.id === definitionId);
  if (!def) return undefined;
  const affected = affectedDevices(issue, project, defs);
  const anchor = nearAffected ? affected[0]?.device : undefined;
  const spot = infraSpot(project, defs, anchor);
  if (!spot) return undefined;
  const id = newId();
  const near = anchor && !anchor.roomId ? centerOf(anchor) : undefined;
  return {
    id: `${issue.id}#add-${definitionId}`,
    label,
    selectAfter: [id],
    apply: (p) => addDevice(p, defs, definitionId, id, near ? { ...spot, near } : spot, affected.map((a) => a.device.id)),
  };
}

/** Integración del hub de la marca que también admite el dispositivo (no ZHA/Zigbee2MQTT). */
function hubIntegration(def: DeviceDefinition, hub: DeviceDefinition): Integration | undefined {
  return def.integrations.find((i) => !ZIGBEE_COORDINATOR_INTEGRATIONS.includes(i) && hub.integrations.includes(i));
}

function zigbeeFixes(issue: ValidationIssue, project: Project, defs: DeviceDefinition[]): QuickFix[] {
  const fixes: QuickFix[] = [];
  const dongle = addInfraFix(issue, project, defs, 'sonoff-zbdongle-p', 'Añadir un coordinador Zigbee (SONOFF ZBDongle-P)', false);
  if (dongle) fixes.push(dongle);
  // Dispositivos de marca con hub ya presente: pasarlos a la integración de su hub.
  const hubs = placed(project, defs).filter((p) => p.def.role === 'hub' && p.def.protocols.includes('zigbee'));
  const moves: { id: Id; integration: Integration }[] = [];
  for (const a of affectedDevices(issue, project, defs)) {
    const hub = hubs.find((h) => h.def.brand === a.def.requiresHub);
    const integration = hub ? hubIntegration(a.def, hub.def) : undefined;
    if (integration) moves.push({ id: a.device.id, integration });
  }
  if (moves.length > 0) {
    const hubNames = [...new Set(moves.map((m) => INTEGRATION_LABELS[m.integration]))].join(' y ');
    fixes.push({
      id: `${issue.id}#use-hub`,
      label: `Usar la integración del hub (${hubNames})`,
      selectAfter: moves.map((m) => m.id),
      apply: (p) => {
        const next = updateDevices(p, moves.map((m) => m.id), (d) => ({ ...d, protocol: 'zigbee', integration: moves.find((m) => m.id === d.id)?.integration ?? d.integration }));
        return withConnections(next, connectionsFor(next, defs, moves.map((m) => m.id)));
      },
    });
  }
  return fixes;
}

function hubFixes(issue: ValidationIssue, project: Project, defs: DeviceDefinition[]): QuickFix[] {
  const fixes: QuickFix[] = [];
  const affected = affectedDevices(issue, project, defs);
  const brand: Brand | undefined = affected.map((a) => requiredHubBrand(a.device, a.def)).find((b) => b !== undefined);
  const hubId = brand ? HUB_FOR_BRAND[brand] : undefined;
  const hubDef = hubId ? defs.find((d) => d.id === hubId) : undefined;
  if (brand && hubId && hubDef) {
    const fix = addInfraFix(issue, project, defs, hubId, `Añadir el hub de ${brand} (${hubDef.name})`, false);
    if (fix) fixes.push(fix);
  }
  const hasCoordinator = placed(project, defs).some((p) => isZigbeeCoordinator(p.def));
  const toZha = affected.filter((a) => a.def.integrations.includes('zha') && a.def.protocols.includes('zigbee'));
  if (hasCoordinator && toZha.length > 0) {
    const ids = toZha.map((a) => a.device.id);
    fixes.push({
      id: `${issue.id}#to-zha`,
      label: toZha.length === 1 ? 'Pasarlo a ZHA con el coordinador Zigbee' : `Pasar los ${toZha.length} dispositivos a ZHA con el coordinador Zigbee`,
      selectAfter: ids,
      apply: (p) => {
        const next = updateDevices(p, ids, (d) => ({ ...d, protocol: 'zigbee', integration: 'zha' }));
        // Las conexiones antiguas con el hub ya no valen: se quitan y se vuelve a conectar.
        const cleaned: Project = { ...next, connections: next.connections.filter((c) => !(ids.includes(c.sourceId) || ids.includes(c.targetId)) || connectionStillValid(next, defs, c)) };
        return withConnections(cleaned, connectionsFor(cleaned, defs, ids));
      },
    });
  }
  return fixes;
}

function connectionStillValid(project: Project, defs: DeviceDefinition[], c: Connection): boolean {
  const a = project.devices.find((d) => d.id === c.sourceId);
  const b = project.devices.find((d) => d.id === c.targetId);
  return a !== undefined && b !== undefined && canConnect(a, b, defs).ok;
}

// ---------- Conexiones y cobertura ----------

function autoConnectFix(issue: ValidationIssue, project: Project, defs: DeviceDefinition[]): QuickFix[] {
  const fixes: QuickFix[] = [];
  const ids = issue.deviceIds;
  const device = project.devices.find((d) => d.id === ids[0]);
  if (!device) return fixes;
  if (connectionsFor(project, defs, ids).length > 0) {
    fixes.push({
      id: `${issue.id}#autoconnect`,
      label: `Autoconectar «${device.name}»`,
      selectAfter: [device.id],
      apply: (p) => withConnections(p, connectionsFor(p, defs, ids)),
    });
  }
  // Fuera de cobertura por radio: acercarlo al equipo compatible más cercano de su planta.
  if (issue.code === 'fuera-de-cobertura') {
    const parent = nearestParent(device, project, defs);
    if (parent) {
      fixes.push({
        id: `${issue.id}#move-near`,
        label: `Acercar «${device.name}» a «${parent.name}»`,
        selectAfter: [device.id],
        apply: (p) => moveNear(p, defs, device.id, parent.id),
      });
    }
  }
  return fixes;
}

function nearestParent(device: Device, project: Project, defs: DeviceDefinition[]): Device | undefined {
  const dist = (o: Device): number => Math.hypot(o.position.x - device.position.x, o.position.y - device.position.y);
  return placed(project, defs)
    .filter((p) => p.device.id !== device.id && p.device.floorId === device.floorId && (isInfra(p.def) || p.def.role === 'router'))
    .filter((p) => canConnect(device, p.device, defs).ok)
    .map((p) => p.device)
    .sort((a, b) => dist(a) - dist(b))[0];
}

function moveNear(project: Project, defs: DeviceDefinition[], deviceId: Id, parentId: Id): Project {
  const device = project.devices.find((d) => d.id === deviceId);
  const parent = project.devices.find((d) => d.id === parentId);
  if (!device || !parent) return project;
  const others: Project = { ...project, devices: project.devices.filter((d) => d.id !== deviceId) };
  const [position = device.position] = placeNewDevices(others, parent.floorId, 1, { near: centerOf(parent) });
  const roomId = resolveRoomId(project.rooms, parent.floorId, position, device.roomId);
  const next = updateDevices(project, [deviceId], (d) => {
    const moved: Device = { ...d, floorId: parent.floorId, position };
    if (roomId) moved.roomId = roomId;
    else delete moved.roomId;
    return moved;
  });
  return withConnections(next, connectionsFor(next, defs, [deviceId]));
}

/** Conexión explícita entre dos dispositivos (si no existe ya). */
function addConnection(project: Project, a: Id, b: Id, protocol: Connection['protocol']): Project {
  if (project.connections.some((c) => (c.sourceId === a && c.targetId === b) || (c.sourceId === b && c.targetId === a))) return project;
  return { ...project, connections: [...project.connections, { id: newId(), sourceId: a, targetId: b, protocol }] };
}

const PARENT_ROLES: readonly DeviceDefinition['role'][] = ['access_point', 'ha_server'];

/**
 * «Conectar a…»: enlace directo con la infraestructura compatible. Para la infraestructura sin
 * conexión, con el router (punto de acceso) o el servidor; para un dispositivo fuera de cobertura,
 * solo los enlaces por cable (la radio depende de la distancia: para eso está «Acercar»).
 */
function connectToFixes(issue: ValidationIssue, project: Project, defs: DeviceDefinition[]): QuickFix[] {
  const all = allDefinitions(project, defs);
  const device = project.devices.find((d) => d.id === issue.deviceIds[0]);
  if (!device) return [];
  const dist = (o: Device): number =>
    (o.floorId === device.floorId ? 0 : 1e6) + Math.hypot(o.position.x - device.position.x, o.position.y - device.position.y);
  const reachable = issue.code === 'fuera-de-cobertura' ? analyzeMesh(project, all).reachable : undefined;
  const fixes: QuickFix[] = [];
  const targets = placed(project, all)
    .filter((p) => p.device.id !== device.id)
    .filter((p) => (issue.code === 'infraestructura-sin-conexion' ? PARENT_ROLES.includes(p.def.role) : isInfra(p.def) && (reachable?.has(p.device.id) ?? true)))
    .sort((a, b) => dist(a.device) - dist(b.device));
  for (const t of targets) {
    if (fixes.length >= 2) break;
    const r = canConnect(device, t.device, all);
    if (!r.ok) continue;
    if (issue.code === 'fuera-de-cobertura' && !isWiredLink(device, t.device, all, r.protocol)) continue;
    const kind = t.def.role === 'ha_server' ? 'al servidor' : t.def.role === 'access_point' ? 'al router' : 'a';
    const protocol = r.protocol;
    fixes.push({
      id: `${issue.id}#connect-${t.device.id}`,
      label: `Conectar ${kind} «${t.device.name}»`,
      selectAfter: [device.id],
      apply: (p) => addConnection(p, device.id, t.device.id, protocol),
    });
  }
  return fixes;
}

/** Repetidor (router de malla o punto de acceso) para extender cada protocolo. */
function repeaterDefinition(device: Device, defs: DeviceDefinition[]): DeviceDefinition | undefined {
  const p = device.protocol;
  if (p === 'wifi' || p === 'matter') return defs.find((d) => d.role === 'access_point' && d.protocols.includes('wifi'));
  const routers = defs.filter((d) => d.role === 'router' && d.protocols.includes(p) && d.integrations.includes(device.integration));
  return routers.find((d) => d.category === 'plug') ?? routers[0];
}

const PROTOCOL_NAMES: Partial<Record<Device['protocol'], string>> = { zigbee: 'Zigbee', zwave: 'Z-Wave', thread: 'Thread', wifi: 'Wi-Fi', matter: 'Wi-Fi' };

/**
 * Coloca repetidores en línea desde el equipo alcanzable más cercano hacia el dispositivo, cada uno
 * lo más lejos posible sin perder la señal, hasta que el dispositivo tenga cobertura (como mucho 6).
 * Devuelve el proyecto y los ids añadidos; `ok` dice si el dispositivo ha quedado alcanzable.
 */
export function addRepeaters(
  project: Project,
  defs: DeviceDefinition[],
  deviceId: Id,
  def: DeviceDefinition,
  ids: readonly Id[] = Array.from({ length: 6 }, newId),
): { project: Project; added: Id[]; ok: boolean } {
  const all = allDefinitions(project, defs);
  let p = project;
  const added: Id[] = [];
  const target = project.devices.find((d) => d.id === deviceId);
  if (!target) return { project, added, ok: false };
  const integration = def.integrations.includes(target.integration) ? target.integration : def.integrations[0];
  const protocol = def.protocols.includes(target.protocol) ? target.protocol : def.protocols[0];
  if (!integration || !protocol) return { project, added, ok: false };
  const make = (q: Project, id: Id, position: Point): Device => {
    const created = createDevice(def, { floorId: target.floorId, position, name: uniqueDeviceName(`Repetidor ${PROTOCOL_NAMES[target.protocol] ?? ''}`.trim(), q.devices) }, q, all);
    const d: Device = { ...created, id, integration, protocol };
    const roomId = roomAt(q, target.floorId, position)?.id;
    if (roomId) d.roomId = roomId;
    else delete d.roomId;
    return d;
  };
  for (let step = 0; step < ids.length; step++) {
    const mesh = analyzeMesh(p, all);
    if (mesh.reachable.has(deviceId)) return { project: p, added, ok: true };
    const probeId = newId();
    // Relé alcanzable más cercano que puede enlazar con un repetidor de este tipo.
    const relays = placed(p, all)
      .filter((x) => mesh.reachable.has(x.device.id) && x.device.floorId === target.floorId && (isInfra(x.def) || x.def.role === 'router'))
      .filter((x) => canConnect(make(p, probeId, x.device.position), x.device, all).ok);
    const dist = (d: Device): number => Math.hypot(d.position.x - target.position.x, d.position.y - target.position.y);
    const relay = relays.map((x) => x.device).sort((a, b) => dist(a) - dist(b))[0];
    if (!relay) break;
    const at = (t: number): Point => ({
      x: Math.round(relay.position.x + (target.position.x - relay.position.x) * t),
      y: Math.round(relay.position.y + (target.position.y - relay.position.y) * t),
    });
    const reachableAt = (t: number): boolean => {
      const q: Project = { ...p, devices: [...p.devices, make(p, probeId, at(t))] };
      return analyzeMesh(q, all).reachable.has(probeId);
    };
    let lo = 0;
    let hi = 1;
    if (reachableAt(1)) lo = 1;
    else {
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (reachableAt(mid)) lo = mid;
        else hi = mid;
      }
      // Un poco de margen para no quedar en el límite exacto del alcance.
      lo *= 0.9;
    }
    const id = ids[step];
    if (lo <= 0 || id === undefined) break;
    const repeater = make(p, id, at(lo));
    p = { ...p, devices: [...p.devices, repeater] };
    p = withConnections(p, connectionsFor(p, all, [id, deviceId]));
    added.push(id);
  }
  return { project: p, added, ok: analyzeMesh(p, all).reachable.has(deviceId) };
}

/** «Añadir un repetidor del protocolo cerca»: solo se ofrece si de verdad le da cobertura. */
function repeaterFix(issue: ValidationIssue, project: Project, defs: DeviceDefinition[]): QuickFix | undefined {
  const all = allDefinitions(project, defs);
  const device = project.devices.find((d) => d.id === issue.deviceIds[0]);
  if (!device) return undefined;
  const def = repeaterDefinition(device, all);
  if (!def) return undefined;
  const ids = Array.from({ length: 6 }, newId);
  const preview = addRepeaters(project, all, device.id, def, ids);
  if (!preview.ok || preview.added.length === 0) return undefined;
  const n = preview.added.length;
  const what = def.role === 'access_point' ? (n === 1 ? 'un punto de acceso Wi-Fi' : `${n} puntos de acceso Wi-Fi`) : n === 1 ? `un repetidor ${PROTOCOL_NAMES[device.protocol] ?? ''}` : `${n} repetidores ${PROTOCOL_NAMES[device.protocol] ?? ''}`;
  return {
    id: `${issue.id}#add-repeater`,
    label: `Añadir ${what.trim()} cerca (${def.name})`,
    selectAfter: preview.added,
    apply: (p) => addRepeaters(p, all, device.id, def, ids).project,
  };
}

function removeConnectionFix(issue: ValidationIssue): QuickFix[] {
  const id = issue.ref?.kind === 'connection' ? issue.ref.id : undefined;
  if (!id) return [];
  return [{ id: `${issue.id}#remove`, label: 'Eliminar la conexión', apply: (p) => ({ ...p, connections: p.connections.filter((c) => c.id !== id) }) }];
}

// ---------- Salas ----------

function roomFix(issue: ValidationIssue, project: Project): QuickFix[] {
  const device = project.devices.find((d) => d.id === issue.deviceIds[0]);
  if (!device) return [];
  const container = roomAt(project, device.floorId, device.position) ?? roomAt(project, device.floorId, centerOf(device));
  if (container) {
    return [
      {
        id: `${issue.id}#assign-room`,
        label: `Asignarlo a «${container.name}»`,
        selectAfter: [device.id],
        apply: (p) => updateDevices(p, [device.id], (d) => ({ ...d, roomId: container.id })),
      },
    ];
  }
  const nearest = nearestRoom(project.rooms.filter((r) => r.floorId === device.floorId && r.polygon.length >= 3), centerOf(device));
  if (!nearest) return [];
  return [
    {
      id: `${issue.id}#move-room`,
      label: `Moverlo a «${nearest.name}»`,
      selectAfter: [device.id],
      apply: (p) => {
        const others: Project = { ...p, devices: p.devices.filter((d) => d.id !== device.id) };
        const [position] = placeNewDevices(others, device.floorId, 1, { roomId: nearest.id });
        if (!position) return p;
        return updateDevices(p, [device.id], (d) => ({ ...d, position, roomId: roomAt(p, d.floorId, position)?.id ?? nearest.id }));
      },
    },
  ];
}

function nearestRoom(rooms: Room[], point: Point): Room | undefined {
  return [...rooms].sort((a, b) => roomDistance(a, point) - roomDistance(b, point))[0];
}

// ---------- Automatizaciones, escenas y scripts ----------

type Owner = 'automation' | 'scene' | 'script';

function mapOwner(project: Project, kind: Owner, id: Id, fns: { automation?: (a: Automation) => Automation; script?: (s: Script) => Script; scene?: (entities: Project['scenes'][number]) => Project['scenes'][number] }): Project {
  if (kind === 'automation' && fns.automation) {
    const f = fns.automation;
    return { ...project, automations: project.automations.map((a) => (a.id === id ? f(a) : a)) };
  }
  if (kind === 'script' && fns.script) {
    const f = fns.script;
    return { ...project, scripts: project.scripts.map((s) => (s.id === id ? f(s) : s)) };
  }
  if (kind === 'scene' && fns.scene) {
    const f = fns.scene;
    return { ...project, scenes: project.scenes.map((s) => (s.id === id ? f(s) : s)) };
  }
  return project;
}

/** Aplica `fn` a cada acción (también a las anidadas), de dentro afuera. `undefined` la elimina. */
function mapActionsDeep(actions: Action[], fn: (a: Action) => Action | undefined, conds: (cs: Condition[]) => Condition[] = (c) => c, trigs: (ts: Trigger[]) => Trigger[] = (t) => t): Action[] {
  const seq = (xs: Action[]): Action[] => mapActionsDeep(xs, fn, conds, trigs);
  const out: Action[] = [];
  for (const a of actions) {
    let next: Action | undefined;
    switch (a.type) {
      case 'choose': {
        const c: Action = { ...a, choices: a.choices.map((o) => ({ conditions: conds(o.conditions), sequence: seq(o.sequence) })) };
        if (a.default) c.default = seq(a.default);
        next = c;
        break;
      }
      case 'if': {
        const c: Action = { ...a, conditions: conds(a.conditions), then: seq(a.then) };
        if (a.else) c.else = seq(a.else);
        next = c;
        break;
      }
      case 'repeat': {
        const c: Action = { ...a, sequence: seq(a.sequence) };
        if (a.while) c.while = conds(a.while);
        if (a.until) c.until = conds(a.until);
        next = c;
        break;
      }
      case 'wait_for_trigger': {
        const triggers = trigs(a.triggers);
        next = triggers.length === 0 ? undefined : { ...a, triggers };
        break;
      }
      default:
        next = a;
    }
    const mapped = next ? fn(next) : undefined;
    if (mapped) out.push(mapped);
  }
  return out;
}

function removeFromConditions(cs: Condition[], entityId: string): Condition[] {
  const out: Condition[] = [];
  for (const c of cs) {
    if ((c.type === 'state' || c.type === 'numeric_state') && c.entityId === entityId) continue;
    if (c.type === 'and' || c.type === 'or' || c.type === 'not') {
      const inner = removeFromConditions(c.conditions, entityId);
      if (inner.length > 0) out.push({ ...c, conditions: inner });
      continue;
    }
    out.push(c);
  }
  return out;
}

function removeFromTriggers(ts: Trigger[], entityId: string): Trigger[] {
  return ts.filter((t) => !((t.type === 'state' || t.type === 'numeric_state' || t.type === 'device_action') && t.entityId === entityId));
}

function removeFromService(a: ServiceAction, entityId: string): ServiceAction | undefined {
  if (a.service === entityId) return undefined; // script.<slug> llamado como servicio
  const extra = (a.targets?.entityIds ?? []).filter((id) => id !== entityId);
  const areas = a.targets?.areaIds ?? [];
  if (a.entityId !== entityId && extra.length === (a.targets?.entityIds ?? []).length) return a;
  const main = a.entityId === entityId ? (extra[0] ?? '') : a.entityId;
  const rest = a.entityId === entityId ? extra.slice(1) : extra;
  if (main === '' && areas.length === 0 && !a.service.startsWith('notify.')) return undefined;
  const next: ServiceAction = { ...a, entityId: main };
  const targets: { entityIds?: string[]; areaIds?: Id[] } = {};
  if (rest.length > 0) targets.entityIds = rest;
  if (areas.length > 0) targets.areaIds = areas;
  if (targets.entityIds || targets.areaIds) next.targets = targets;
  else delete next.targets;
  return next;
}

/** Quita toda referencia a `entityId` de una automatización, script o escena. */
export function removeEntityReference(project: Project, kind: Owner, ownerId: Id, entityId: string): Project {
  const conds = (cs: Condition[]): Condition[] => removeFromConditions(cs, entityId);
  const trigs = (ts: Trigger[]): Trigger[] => removeFromTriggers(ts, entityId);
  const fn = (a: Action): Action | undefined => (a.type === 'service' ? removeFromService(a, entityId) : a);
  return mapOwner(project, kind, ownerId, {
    automation: (a) => ({ ...a, triggers: trigs(a.triggers), conditions: conds(a.conditions), actions: mapActionsDeep(a.actions, fn, conds, trigs) }),
    script: (s) => ({ ...s, sequence: mapActionsDeep(s.sequence, fn, conds, trigs) }),
    scene: (s) => ({ ...s, entities: Object.fromEntries(Object.entries(s.entities).filter(([id]) => id !== entityId)) }),
  });
}

function knownEntities(project: Project, defs: DeviceDefinition[]): string[] {
  defs = allDefinitions(project, defs);
  return [
    ...placed(project, defs).flatMap((p) => entitiesForDevice(p.device, p.def).map((e) => e.entityId)),
    ...Object.keys(peopleEntities(project)),
    ...(project.groups ?? []).map(groupEntityId),
  ];
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j] ?? 0;
      row[j] = Math.min((row[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length] ?? 0;
}

/** Entidad existente del mismo dominio con un nombre parecido (p. ej. tras renombrar un dispositivo). */
export function similarEntity(entityId: string, candidates: readonly string[]): string | undefined {
  const domain = entityId.split('.')[0] ?? '';
  const object = entityId.slice(domain.length + 1);
  if (object === '') return undefined;
  const scored = candidates
    .filter((c) => c.startsWith(`${domain}.`) && c !== entityId)
    .map((c) => ({ c, d: levenshtein(object, c.slice(domain.length + 1)) }))
    .sort((x, y) => x.d - y.d || x.c.localeCompare(y.c));
  const best = scored[0];
  return best && best.d <= Math.max(2, Math.floor(object.length / 4)) ? best.c : undefined;
}

function unknownEntityFixes(issue: ValidationIssue, project: Project, defs: DeviceDefinition[]): QuickFix[] {
  const ref = issue.ref;
  if (!ref || (ref.kind !== 'automation' && ref.kind !== 'scene' && ref.kind !== 'script') || ref.entityId === undefined) return [];
  const kind: Owner = ref.kind;
  const entityId = ref.entityId;
  const fixes: QuickFix[] = [];
  const similar = entityId === '' ? undefined : similarEntity(entityId, knownEntities(project, defs));
  if (similar) {
    fixes.push({ id: `${issue.id}#use-similar`, label: `Usar ${similar}`, apply: (p) => renameEntityRefs(p, { [entityId]: similar }) });
  }
  fixes.push({
    id: `${issue.id}#remove-ref`,
    label: entityId === '' ? 'Quitar la acción sin entidad' : `Quitar la referencia a ${entityId}`,
    apply: (p) => removeEntityReference(p, kind, ref.id, entityId),
  });
  return fixes;
}

const NEUTRAL_SERVICES = new Set(['turn_on', 'turn_off', 'toggle']);

/** Servicio equivalente para el dominio de la entidad (switch.turn_off → light.turn_off). */
export function serviceForDomain(service: string, domain: string): string | undefined {
  const name = service.slice(service.indexOf('.') + 1);
  if (serviceInfo(`${domain}.${name}`)) return `${domain}.${name}`;
  return NEUTRAL_SERVICES.has(name) ? `homeassistant.${name}` : undefined;
}

function serviceDomainFixes(issue: ValidationIssue): QuickFix[] {
  const ref = issue.ref;
  if (!ref || (ref.kind !== 'automation' && ref.kind !== 'script') || !ref.entityId || !ref.service) return [];
  const kind: Owner = ref.kind;
  const { entityId, service } = ref;
  const domain = entityId.split('.')[0] ?? '';
  const replacement = serviceForDomain(service, domain);
  if (!replacement) return [];
  const fn = (a: Action): Action =>
    a.type === 'service' && a.service === service && (a.entityId === entityId || (a.targets?.entityIds ?? []).includes(entityId)) ? { ...a, service: replacement } : a;
  return [
    {
      id: `${issue.id}#service`,
      label: `Cambiar a ${replacement}`,
      apply: (p) =>
        mapOwner(p, kind, ref.id, {
          automation: (a) => ({ ...a, actions: mapActionsDeep(a.actions, fn) }),
          script: (s) => ({ ...s, sequence: mapActionsDeep(s.sequence, fn) }),
        }),
    },
  ];
}

function duplicateScriptFix(issue: ValidationIssue, project: Project): QuickFix[] {
  const slug = issue.ref?.slug;
  if (!slug || project.scripts.filter((s) => slugify(s.name) === slug).length < 2) return [];
  return [
    {
      id: `${issue.id}#rename`,
      label: 'Renombrar los scripts repetidos',
      apply: (p) => {
        const taken = p.scripts.map((s) => s.name);
        let first = true;
        const scripts = p.scripts.map((s) => {
          if (slugify(s.name) !== slug) return s;
          if (first) {
            first = false;
            return s;
          }
          const name = uniqueDeviceName(s.name, taken);
          taken.push(name);
          return { ...s, name };
        });
        return { ...p, scripts };
      },
    },
  ];
}

function duplicateEntityFix(issue: ValidationIssue, project: Project): QuickFix[] {
  const [, ...later] = issue.deviceIds;
  if (later.length === 0) return [];
  const names = later.map((id) => project.devices.find((d) => d.id === id)?.name).filter((n): n is string => n !== undefined);
  return [
    {
      id: `${issue.id}#rename`,
      label: names.length === 1 ? `Renombrar «${names[0] ?? ''}»` : 'Renombrar los dispositivos repetidos',
      selectAfter: later,
      apply: (p) => {
        const taken = p.devices.map((d) => d.name);
        return {
          ...p,
          devices: p.devices.map((d) => {
            if (!later.includes(d.id)) return d;
            const name = uniqueDeviceName(d.name, taken);
            taken.push(name);
            return { ...d, name };
          }),
        };
      },
    },
  ];
}

function removeDeviceFix(issue: ValidationIssue, project: Project): QuickFix[] {
  const device = project.devices.find((d) => d.id === issue.deviceIds[0]);
  if (!device) return [];
  return [
    {
      id: `${issue.id}#remove-device`,
      label: `Eliminar «${device.name}»`,
      apply: (p) => ({
        ...p,
        devices: p.devices.filter((d) => d.id !== device.id),
        connections: p.connections.filter((c) => c.sourceId !== device.id && c.targetId !== device.id),
      }),
    },
  ];
}

// ---------- Entrada ----------

/** Arreglos rápidos aplicables a una incidencia del validador (lista vacía si no hay ninguno). */
export function quickFixesFor(issue: ValidationIssue, project: Project, defs: DeviceDefinition[]): QuickFix[] {
  const result = ((): (QuickFix | undefined)[] => {
    switch (issue.code) {
      case 'sin-servidor-ha':
        return [addInfraFix(issue, project, defs, 'ha-green', 'Añadir Home Assistant Green', false)];
      case 'zigbee-sin-coordinador':
        return zigbeeFixes(issue, project, defs);
      case 'thread-sin-border-router':
        return [addInfraFix(issue, project, defs, 'google-nest-hub-2', 'Añadir un border router Thread (Google Nest Hub)', true)];
      case 'zwave-sin-controlador':
        return [addInfraFix(issue, project, defs, 'ha-connect-zwa-2', 'Añadir el controlador Z-Wave (Connect ZWA-2)', false)];
      case 'rf433-sin-puente':
        return [addInfraFix(issue, project, defs, 'sonoff-rf-bridge-r2', 'Añadir un puente RF 433 (SONOFF RF Bridge)', true)];
      case 'ble-sin-proxy':
        return [addInfraFix(issue, project, defs, 'shelly-1pm-gen3', 'Añadir un proxy Bluetooth cerca (Shelly 1PM Gen3)', true)];
      case 'falta-hub-propietario':
        return hubFixes(issue, project, defs);
      case 'fuera-de-cobertura':
        return [...autoConnectFix(issue, project, defs), ...connectToFixes(issue, project, defs), repeaterFix(issue, project, defs)];
      case 'infraestructura-sin-conexion':
        return [...autoConnectFix(issue, project, defs), ...connectToFixes(issue, project, defs)];
      case 'conexion-invalida':
      case 'conexion-protocolo-incompatible':
        return removeConnectionFix(issue);
      case 'dispositivo-sin-sala':
        return roomFix(issue, project);
      case 'servicio-dominio-incompatible':
        return serviceDomainFixes(issue);
      case 'entidad-desconocida':
        return unknownEntityFixes(issue, project, defs);
      case 'nombre-script-duplicado':
        return duplicateScriptFix(issue, project);
      case 'entity-id-duplicado':
        return duplicateEntityFix(issue, project);
      case 'definicion-desconocida':
        return removeDeviceFix(issue, project);
      default:
        return [];
    }
  })();
  return result.filter((f): f is QuickFix => f !== undefined);
}
