// Reglas de compatibilidad entre dispositivos y conexión automática.
import type { Connection, Device, DeviceDefinition, Floor, Id, Project, Protocol } from '../types';
import { INTEGRATION_LABELS, PROTOCOL_LABELS } from '../devices/labels';
import {
  isBleProxy,
  isInfra,
  isRfBridge,
  isThreadBorderRouter,
  isZigbeeCoordinator,
  isZwaveController,
  MESH_PROTOCOLS,
  zigbeeNetworkOf,
} from '../devices/roles';
import { deviceDistanceMeters, isInRange } from './coverage';
import { allDefinitions } from '../devices/catalog';

export type ConnectResult = { ok: true; protocol: Protocol } | { ok: false; reason: string };

interface Node {
  device: Device;
  def: DeviceDefinition;
}

const ok = (protocol: Protocol): ConnectResult => ({ ok: true, protocol });
const no = (reason: string): ConnectResult => ({ ok: false, reason });

/** Protocolos cableados: no dependen del alcance radio. */
export const WIRED_PROTOCOLS: readonly Protocol[] = ['ethernet'];

function connectEndpoints(a: Node, b: Node): ConnectResult {
  const p = a.device.protocol;
  if (p === 'ble' && isBleProxy(b.def)) return ok('ble');
  if (b.device.protocol === 'ble' && isBleProxy(a.def)) return ok('ble');
  if (p !== b.device.protocol) {
    return no(`No comparten protocolo (${PROTOCOL_LABELS[p]} y ${PROTOCOL_LABELS[b.device.protocol]})`);
  }
  if (!MESH_PROTOCOLS.includes(p)) {
    return no(`Dos dispositivos finales no se conectan entre sí por ${PROTOCOL_LABELS[p]}: necesitan un hub, router o punto de acceso`);
  }
  if (a.def.role !== 'router' && b.def.role !== 'router') {
    return no('Dos dispositivos finales no pueden conectarse entre sí; al menos uno debe ser router de la malla');
  }
  if (p === 'zigbee' && zigbeeNetworkOf(a.device, a.def) !== zigbeeNetworkOf(b.device, b.def)) {
    return no('Pertenecen a redes Zigbee distintas (coordinador frente a hub propietario)');
  }
  return ok(p);
}

function connectInfraPair(a: Node, b: Node): ConnectResult {
  const server = a.def.role === 'ha_server' ? a : b.def.role === 'ha_server' ? b : undefined;
  const other = server === a ? b : a;
  if (server && other.def.role === 'coordinator') {
    const radio = other.def.protocols[0];
    if (radio) return ok(radio);
  }
  if (a.def.role === 'coordinator' || b.def.role === 'coordinator') {
    return no('Un coordinador USB solo se conecta al servidor de Home Assistant');
  }
  for (const p of ['ethernet', 'wifi', 'thread'] as const) {
    if (a.def.protocols.includes(p) && b.def.protocols.includes(p)) {
      if (p === 'wifi' && a.def.role !== 'access_point' && b.def.role !== 'access_point') continue;
      return ok(p);
    }
  }
  return no('Estos equipos de infraestructura no comparten un enlace de red compatible');
}

function zigbeeToInfra(dev: Node, infra: Node): ConnectResult {
  const network = zigbeeNetworkOf(dev.device, dev.def);
  if (isZigbeeCoordinator(infra.def)) {
    return network === 'coordinator'
      ? ok('zigbee')
      : no(`Usa la integración ${INTEGRATION_LABELS[dev.device.integration]}: necesita el hub de ${dev.def.requiresHub ?? 'su marca'}, no un coordinador`);
  }
  if (infra.def.role === 'hub' && infra.def.protocols.includes('zigbee')) {
    if (network === `hub:${infra.def.brand}`) return ok('zigbee');
    return no(`El hub de ${infra.def.brand} solo admite sus propios dispositivos con su integración`);
  }
  return no(`${infra.def.name} no tiene radio Zigbee para hacer de coordinador`);
}

function endpointToInfra(dev: Node, infra: Node): ConnectResult {
  const p = dev.device.protocol;
  const role = infra.def.role;
  switch (p) {
    case 'ble':
      return isBleProxy(infra.def) ? ok('ble') : no('Los dispositivos BLE necesitan un proxy Bluetooth (p. ej. un Shelly Gen2/Gen3)');
    case 'wifi':
    case 'matter':
      return role === 'access_point'
        ? ok(p)
        : no('Los dispositivos Wi-Fi se conectan a un router o punto de acceso Wi-Fi');
    case 'ethernet':
      return role === 'access_point' || role === 'ha_server'
        ? ok('ethernet')
        : no('Los dispositivos Ethernet se conectan a un router o al servidor');
    case 'zigbee':
      return zigbeeToInfra(dev, infra);
    case 'thread':
      return isThreadBorderRouter(infra.def) ? ok('thread') : no('Los dispositivos Thread necesitan un border router Thread');
    case 'zwave':
      return isZwaveController(infra.def) ? ok('zwave') : no('Los dispositivos Z-Wave necesitan un controlador Z-Wave');
    case 'rf433':
      return isRfBridge(infra.def) ? ok('rf433') : no('Los sensores RF 433 MHz necesitan un puente RF');
  }
}

function connectNodes(a: Node, b: Node): ConnectResult {
  if (a.device.id === b.device.id) return no('Un dispositivo no puede conectarse consigo mismo');
  const ia = isInfra(a.def);
  const ib = isInfra(b.def);
  if (ia && ib) return connectInfraPair(a, b);
  if (ia) return endpointToInfra(b, a);
  if (ib) return endpointToInfra(a, b);
  return connectEndpoints(a, b);
}

function nodeOf(device: Device, defs: DeviceDefinition[]): Node | undefined {
  const def = defs.find((d) => d.id === device.definitionId);
  return def ? { device, def } : undefined;
}

/** ¿Pueden conectarse directamente? Devuelve el protocolo del enlace o el motivo en español. */
export function canConnect(a: Device, b: Device, defs: DeviceDefinition[]): ConnectResult {
  const na = nodeOf(a, defs);
  const nb = nodeOf(b, defs);
  if (!na || !nb) return no('Definición de dispositivo desconocida');
  return connectNodes(na, nb);
}

/** ¿El enlace es cableado / físico (no depende del alcance)? */
export function isWiredLink(a: Device, b: Device, defs: DeviceDefinition[], protocol: Protocol): boolean {
  if (WIRED_PROTOCOLS.includes(protocol)) return true;
  const da = defs.find((d) => d.id === a.definitionId);
  const db = defs.find((d) => d.id === b.definitionId);
  // Coordinador USB enchufado al servidor.
  return (da?.role === 'coordinator' && db?.role === 'ha_server') || (db?.role === 'coordinator' && da?.role === 'ha_server');
}

/** Raíces de la red: coordinadores, hubs, border routers, puntos de acceso y servidor HA. */
export function isRootDevice(device: Device, defs: DeviceDefinition[]): boolean {
  const def = defs.find((d) => d.id === device.definitionId);
  return def !== undefined && isInfra(def);
}

// ---------- Conexión automática ----------

interface Candidate {
  parent: Device;
  protocol: Protocol;
  distance: number;
  infra: boolean;
}

function distanceOf(a: Device, b: Device, floors: Floor[]): number {
  return deviceDistanceMeters(a, b, floors) ?? Number.POSITIVE_INFINITY;
}

function bestCandidate(candidates: Candidate[]): Candidate | undefined {
  return [...candidates].sort((x, y) => Number(y.infra) - Number(x.infra) || x.distance - y.distance)[0];
}

/** Enlace de subida de un equipo de infraestructura (coordinador → servidor; hub/AP → AP o servidor). */
function infraUplink(device: Device, def: DeviceDefinition, project: Project, defs: DeviceDefinition[]): Candidate | undefined {
  if (def.role === 'ha_server') return undefined;
  const targets = def.role === 'coordinator' ? ['ha_server'] : def.role === 'access_point' ? ['ha_server'] : ['access_point', 'ha_server'];
  const candidates: (Candidate & { rank: number })[] = [];
  for (const other of project.devices) {
    const od = defs.find((d) => d.id === other.definitionId);
    if (!od || other.id === device.id || !targets.includes(od.role)) continue;
    const r = canConnect(device, other, defs);
    if (!r.ok) continue;
    const rank = od.role === 'access_point' ? 0 : 1;
    candidates.push({ parent: other, protocol: r.protocol, distance: distanceOf(device, other, project.floors), infra: true, rank });
  }
  return candidates.sort((x, y) => x.rank - y.rank || x.distance - y.distance)[0];
}

function canRelayTo(parentDef: DeviceDefinition, child: Device): boolean {
  if (isInfra(parentDef) || parentDef.role === 'router') return true;
  return child.protocol === 'ble' && isBleProxy(parentDef);
}

function radioCandidates(
  device: Device,
  parents: readonly Device[],
  project: Project,
  defs: DeviceDefinition[],
  requireRange: boolean,
): Candidate[] {
  const result: Candidate[] = [];
  for (const parent of parents) {
    const pd = defs.find((d) => d.id === parent.definitionId);
    if (!pd || parent.id === device.id || !canRelayTo(pd, device)) continue;
    const r = canConnect(device, parent, defs);
    if (!r.ok) continue;
    const wired = isWiredLink(device, parent, defs, r.protocol);
    if (wired && !isInfra(pd)) continue;
    if (requireRange && !wired && !isInRange(device, parent, defs, project.floors, r.protocol)) continue;
    result.push({ parent, protocol: r.protocol, distance: distanceOf(device, parent, project.floors), infra: isInfra(pd) });
  }
  return result;
}

function makeConnection(child: Device, c: Candidate): Connection {
  return { id: crypto.randomUUID(), sourceId: child.id, targetId: c.parent.id, protocol: c.protocol };
}

/**
 * Conecta cada dispositivo sin enlace de subida a su padre lógico más cercano.
 * Convención: sourceId = hijo, targetId = padre. Solo devuelve las conexiones nuevas;
 * se omiten los dispositivos que ya son origen de alguna conexión.
 * Se recorre la red por capas desde la infraestructura, prefiriendo infraestructura a routers
 * y padres a alcance; si no hay ninguno a alcance se usa el compatible más cercano.
 */
export function suggestConnections(project: Project, defs: DeviceDefinition[]): Connection[] {
  defs = allDefinitions(project, defs);
  const hasUplink = new Set(project.connections.map((c) => c.sourceId));
  const result: Connection[] = [];
  const known = project.devices.filter((d) => defs.some((def) => def.id === d.definitionId));

  for (const device of known) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def || !isInfra(def) || hasUplink.has(device.id)) continue;
    const up = infraUplink(device, def, project, defs);
    if (up) result.push(makeConnection(device, up));
  }

  const attached: Device[] = known.filter((d) => isRootDevice(d, defs));
  let pending = known.filter((d) => !isRootDevice(d, defs));
  let frontier = [...attached];
  while (pending.length > 0 && frontier.length > 0) {
    const next: Device[] = [];
    for (const device of pending) {
      const best = bestCandidate(radioCandidates(device, frontier, project, defs, true));
      if (!best) continue;
      if (!hasUplink.has(device.id)) result.push(makeConnection(device, best));
      next.push(device);
    }
    pending = pending.filter((d) => !next.includes(d));
    attached.push(...next);
    frontier = next;
  }

  for (const device of pending) {
    if (hasUplink.has(device.id)) continue;
    const best = bestCandidate(radioCandidates(device, attached, project, defs, false));
    if (best) result.push(makeConnection(device, best));
  }
  return result;
}

// ---------- Explicación de lo que no se puede conectar ----------

export interface UnconnectedReason {
  deviceId: Id;
  /** Motivo en español, empezando por el nombre del dispositivo. */
  reason: string;
}

function missingParentReason(device: Device, def: DeviceDefinition, present: DeviceDefinition[]): string | undefined {
  const has = (pred: (d: DeviceDefinition) => boolean): boolean => present.some(pred);
  if (def.role === 'coordinator') return has((d) => d.role === 'ha_server') ? undefined : 'no hay servidor Home Assistant al que enchufar el coordinador';
  if (isInfra(def)) {
    return has((d) => d.role === 'access_point' || d.role === 'ha_server') ? undefined : 'no hay router Wi-Fi ni servidor Home Assistant al que conectarlo';
  }
  switch (device.protocol) {
    case 'zigbee': {
      const network = zigbeeNetworkOf(device, def);
      if (network === 'coordinator') {
        return has(isZigbeeCoordinator) ? undefined : `usa ${INTEGRATION_LABELS[device.integration]} y no hay coordinador Zigbee (añade un dongle Zigbee)`;
      }
      const brand = def.requiresHub ?? def.brand;
      if (has((d) => d.role === 'hub' && d.brand === brand && d.protocols.includes('zigbee'))) return undefined;
      return `usa ${INTEGRATION_LABELS[device.integration]} y falta el hub de ${brand}; añádelo o cambia a ZHA/Zigbee2MQTT con un coordinador`;
    }
    case 'thread':
      return has(isThreadBorderRouter) ? undefined : 'es Thread y no hay border router Thread (HomePod, Nest Hub, Echo 4, Aqara M3...)';
    case 'zwave':
      return has(isZwaveController) ? undefined : 'es Z-Wave y no hay controlador Z-Wave';
    case 'wifi':
    case 'matter':
      return has((d) => d.role === 'access_point') ? undefined : `es ${PROTOCOL_LABELS[device.protocol]} y no hay router ni punto de acceso Wi-Fi`;
    case 'ethernet':
      return has((d) => d.role === 'access_point' || d.role === 'ha_server') ? undefined : 'es Ethernet y no hay router ni servidor al que cablearlo';
    case 'ble':
      return has(isBleProxy) ? undefined : 'es Bluetooth LE y no hay proxy Bluetooth (p. ej. un Shelly Gen2/Gen3)';
    case 'rf433':
      return has(isRfBridge) ? undefined : 'es RF 433 MHz y no hay puente RF';
  }
}

/** Primer motivo de incompatibilidad con los posibles padres, si ninguno vale. */
function firstIncompatibility(device: Device, project: Project, defs: DeviceDefinition[]): string | undefined {
  for (const other of project.devices) {
    const od = defs.find((d) => d.id === other.definitionId);
    if (!od || other.id === device.id || !(isInfra(od) || od.role === 'router')) continue;
    const r = canConnect(device, other, defs);
    if (!r.ok) return `${other.name}: ${r.reason}`;
  }
  return undefined;
}

/**
 * Por qué cada dispositivo sigue sin enlace de subida tras Autoconectar (ni lo tenía ni se le
 * puede sugerir uno). El servidor HA no necesita enlace y no aparece.
 */
export function explainUnconnected(project: Project, defs: DeviceDefinition[]): UnconnectedReason[] {
  defs = allDefinitions(project, defs);
  const linked = new Set([...project.connections, ...suggestConnections(project, defs)].map((c) => c.sourceId));
  const present = project.devices.map((d) => defs.find((x) => x.id === d.definitionId)).filter((d): d is DeviceDefinition => d !== undefined);
  const result: UnconnectedReason[] = [];
  for (const device of project.devices) {
    if (linked.has(device.id)) continue;
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def) {
      result.push({ deviceId: device.id, reason: `${device.name}: definición de catálogo desconocida (${device.definitionId})` });
      continue;
    }
    if (def.role === 'ha_server') continue;
    const reason =
      missingParentReason(device, def, present) ??
      firstIncompatibility(device, project, defs) ??
      'no hay ningún equipo compatible al que conectarlo';
    result.push({ deviceId: device.id, reason: `${device.name}: ${reason}` });
  }
  return result;
}
