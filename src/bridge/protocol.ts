// Protocolo WebSocket entre la app (cliente gráfico del lab) y hasim-orchestrator (servidor del
// lab). Versionado: cada mensaje lleva `v` y el servidor rechaza versiones que no conoce.
// Tipos y validación ligera, sin dependencias: lo importan la app y el orquestador.
import type { DeviceDefinition, DeviceTransport, EntityState, HaBridgeSettings, Id, Project, ServiceData } from '../types';
import type { BridgeAvailability } from './mqtt/availability';

export const PROTOCOL_VERSION = 1;

/** Estado de un nodo (dispositivo emulado) del lab. */
export type NodeState = 'stopped' | 'starting' | 'running' | 'error';

export type TrafficDirection = 'out' | 'in';

/** Vía del mensaje en el inspector de tráfico. */
export type TrafficVia = 'mqtt' | 'zwave' | 'esphome';

/**
 * Mensaje visto por el orquestador (inspector de tráfico): MQTT, o un resumen de una trama Z-Wave
 * o de un mensaje de la API nativa de ESPHome (en `topic`, p. ej. «zwave/nodo 7/Binary Switch/Set»).
 */
export interface TrafficEntry {
  seq: number;
  /** Hora real (ms). */
  t: number;
  /** out: hacia HA (publicado o reportado por el orquestador); in: de HA (comandos, homeassistant/status). */
  dir: TrafficDirection;
  topic: string;
  payload: string;
  retain: boolean;
  deviceId?: Id;
  /** Sin valor: MQTT. */
  via?: TrafficVia;
}

export interface SnapshotInfo {
  id: string;
  name: string;
  createdAt: string;
  /** Bytes copiados de ha-config. */
  bytes: number;
  projectName?: string;
  /** false si se guardó con «Excluir credenciales» (sin .storage/auth*). */
  credentials?: boolean;
}

export type LabAction = 'reset' | 'snapshot' | 'restore' | 'list_snapshots' | 'delete_snapshot';

export type ServiceStatus = 'connected' | 'connecting' | 'disconnected';

export interface TransportStatus {
  devices: number;
  /** active: llega por su vía (real o MQTT); pending: publicado por MQTT genérico (vía real pendiente o perfil desactivado). */
  status: 'active' | 'pending';
}

/** Estado de una vía real (Z-Wave JS UI, nodos ESPHome). */
export type NativeServiceState = 'disabled' | 'connecting' | 'connected' | 'error';

/** Estado de un nodo de una vía real. */
export type NativeNodeState = 'starting' | 'running' | 'stopped' | 'error';

export interface NativeStatus {
  state: NativeServiceState;
  /** Texto para la interfaz («Z-Wave JS UI conectado», «2 nodos en marcha»...). */
  detail: string;
  nodes: Record<Id, { state: NativeNodeState; detail?: string }>;
  /** Interfaz web del servicio (Z-Wave JS UI en http://localhost:8091). */
  url?: string;
}

// ---------- App → orquestador ----------

export type ClientMessage =
  /** Primer mensaje obligatorio: sin un token válido el orquestador cierra la conexión. */
  | { v: number; type: 'hello'; role: 'app'; client: string; token: string; version?: string }
  | { v: number; type: 'project'; mode: 'full'; project: Project; definitions: DeviceDefinition[]; settings: HaBridgeSettings }
  | { v: number; type: 'project'; mode: 'patch'; changes: Partial<Project>; definitions?: DeviceDefinition[]; settings?: HaBridgeSettings }
  | { v: number; type: 'state'; full?: boolean; entities: Record<string, EntityState>; removed?: string[]; availability?: BridgeAvailability }
  | { v: number; type: 'node'; action: 'start' | 'stop'; deviceIds: Id[] | 'all' }
  | { v: number; type: 'lab'; action: LabAction; requestId: string; name?: string; id?: string; excludeCredentials?: boolean }
  /** La app desactiva el lab: el orquestador retira las automatizaciones que exportó a HA. */
  | { v: number; type: 'goodbye' }
  | { v: number; type: 'traffic'; subscribe: boolean }
  | { v: number; type: 'command_result'; id: string; ok: boolean; error?: string };

// ---------- Orquestador → app ----------

export interface StatusMessage {
  v: number;
  type: 'status';
  mqtt: ServiceStatus;
  /** Estado de HA visto por MQTT (homeassistant/status). */
  ha: 'online' | 'offline' | 'unknown';
  transports: Partial<Record<DeviceTransport, TransportStatus>>;
  nodes: Record<Id, NodeState>;
  snapshots?: SnapshotInfo[];
  /**
   * El orquestador tiene acceso a ha-config (snapshots) y a Docker (restaurar exige Docker); zwave y
   * esphome: perfiles activos (sus dispositivos llegan a HA por Z-Wave JS y la API de ESPHome).
   */
  capabilities?: { snapshots: boolean; docker: boolean; haToken: boolean; zwave?: boolean; esphome?: boolean };
  /** Estado de las vías reales activas. */
  native?: Partial<Record<'zwave_js' | 'esphome', NativeStatus>>;
  lastError?: string;
}

export type ServerMessage =
  /**
   * Respuesta al hello con token válido. readOnly: otra app controla el laboratorio; esta solo
   * ve el estado y el tráfico. Si la que controla se va, el orquestador manda otro hello con
   * readOnly: false a la siguiente.
   */
  | { v: number; type: 'hello'; server: 'hasim-orchestrator'; version: string; protocol: number; readOnly: boolean }
  | { v: number; type: 'command'; id: string; entityId: string; service: string; data: ServiceData; topic?: string }
  | StatusMessage
  | {
      v: number;
      type: 'lab_result';
      requestId: string;
      action: LabAction;
      ok: boolean;
      message: string;
      snapshots?: SnapshotInfo[];
      /** restore: proyecto guardado en el snapshot. reset: la app vuelve a los estados iniciales. */
      project?: Project;
    }
  | { v: number; type: 'traffic'; entries: TrafficEntry[] }
  /** code 'auth': token ausente o no válido (el orquestador cierra); 'readonly': acción de una app de solo lectura. */
  | { v: number; type: 'error'; message: string; code?: 'auth' | 'readonly' | 'invalid' };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const CLIENT_TYPES = new Set(['hello', 'project', 'state', 'node', 'lab', 'traffic', 'command_result', 'goodbye']);
const SERVER_TYPES = new Set(['hello', 'command', 'status', 'lab_result', 'traffic', 'error']);
const LAB_ACTIONS = new Set<string>(['reset', 'snapshot', 'restore', 'list_snapshots', 'delete_snapshot']);

/** Lee un mensaje de la app; lanza Error (en español) si no es válido. */
export function parseClientMessage(text: string): ClientMessage {
  const raw: unknown = JSON.parse(text);
  if (!isObj(raw)) throw new Error('Mensaje no válido: debe ser un objeto');
  if (raw.v !== PROTOCOL_VERSION) throw new Error(`Versión de protocolo no soportada: ${String(raw.v)} (se esperaba ${PROTOCOL_VERSION})`);
  if (typeof raw.type !== 'string' || !CLIENT_TYPES.has(raw.type)) throw new Error(`Tipo de mensaje desconocido: ${String(raw.type)}`);
  switch (raw.type) {
    case 'hello':
      if (typeof raw.token !== 'string') throw new Error('hello sin token del laboratorio');
      break;
    case 'project':
      if (raw.mode === 'full' && (!isObj(raw.project) || !Array.isArray(raw.definitions) || !isObj(raw.settings))) throw new Error('project completo sin project, definitions o settings');
      if (raw.mode === 'patch' && !isObj(raw.changes)) throw new Error('project parcial sin changes');
      if (raw.mode !== 'full' && raw.mode !== 'patch') throw new Error('project: mode debe ser full o patch');
      break;
    case 'state':
      if (!isObj(raw.entities)) throw new Error('state sin entities');
      break;
    case 'node':
      if (raw.action !== 'start' && raw.action !== 'stop') throw new Error('node: action debe ser start o stop');
      if (raw.deviceIds !== 'all' && !(Array.isArray(raw.deviceIds) && raw.deviceIds.every((x) => typeof x === 'string'))) throw new Error('node: deviceIds no válido');
      break;
    case 'lab':
      if (typeof raw.action !== 'string' || !LAB_ACTIONS.has(raw.action)) throw new Error(`lab: acción desconocida ${String(raw.action)}`);
      if (typeof raw.requestId !== 'string') throw new Error('lab sin requestId');
      if (raw.id !== undefined && typeof raw.id !== 'string') throw new Error('lab: id no válido');
      if (raw.name !== undefined && typeof raw.name !== 'string') throw new Error('lab: name no válido');
      if (raw.excludeCredentials !== undefined && typeof raw.excludeCredentials !== 'boolean') throw new Error('lab: excludeCredentials no válido');
      break;
    case 'traffic':
      if (typeof raw.subscribe !== 'boolean') throw new Error('traffic sin subscribe');
      break;
    case 'command_result':
      if (typeof raw.id !== 'string' || typeof raw.ok !== 'boolean') throw new Error('command_result no válido');
      break;
    default:
      break;
  }
  return raw as unknown as ClientMessage;
}

/** Lee un mensaje del orquestador; null si no es válido (la app lo ignora). */
export function parseServerMessage(text: string): ServerMessage | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (!isObj(raw) || raw.v !== PROTOCOL_VERSION || typeof raw.type !== 'string' || !SERVER_TYPES.has(raw.type)) return null;
    if (raw.type === 'command' && (typeof raw.entityId !== 'string' || typeof raw.service !== 'string' || typeof raw.id !== 'string')) return null;
    if (raw.type === 'hello' && typeof raw.readOnly !== 'boolean') return null;
    if (raw.type === 'lab_result' && (typeof raw.requestId !== 'string' || typeof raw.action !== 'string' || typeof raw.ok !== 'boolean')) return null;
    return raw as unknown as ServerMessage;
  } catch {
    return null;
  }
}

/** Serializa un mensaje con la versión del protocolo. */
export function encode<T extends { type: string }>(msg: T): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...msg });
}

/** Payload recortado para el inspector de tráfico. */
export const TRAFFIC_PAYLOAD_LIMIT = 4096;

export function trafficPayload(payload: string): string {
  return payload.length > TRAFFIC_PAYLOAD_LIMIT ? `${payload.slice(0, TRAFFIC_PAYLOAD_LIMIT)}… (${payload.length} bytes)` : payload;
}

/** Filtro del inspector de tráfico (puro, para la pestaña «Tráfico»). */
export interface TrafficFilter {
  deviceId?: Id;
  dir?: TrafficDirection;
  /** Subcadena del topic (o patrón MQTT con + y #). */
  topic?: string;
}

/** ¿Encaja el topic con un patrón MQTT (+ un nivel, # el resto)? */
export function topicMatches(pattern: string, topic: string): boolean {
  const p = pattern.split('/');
  const t = topic.split('/');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '#') return true;
    if (i >= t.length) return false;
    if (p[i] !== '+' && p[i] !== t[i]) return false;
  }
  return p.length === t.length;
}

export function filterTraffic(entries: readonly TrafficEntry[], f: TrafficFilter): TrafficEntry[] {
  const q = f.topic?.trim() ?? '';
  const pattern = q.includes('+') || q.includes('#');
  return entries.filter(
    (e) =>
      (f.deviceId === undefined || f.deviceId === '' || e.deviceId === f.deviceId) &&
      (f.dir === undefined || e.dir === f.dir) &&
      (q === '' || (pattern ? topicMatches(q, e.topic) : e.topic.toLowerCase().includes(q.toLowerCase()))),
  );
}

/** Añade entradas a un búfer circular de como mucho `max` elementos. */
export function pushRing<T>(buffer: readonly T[], items: readonly T[], max: number): T[] {
  const next = buffer.length + items.length > max ? [...buffer, ...items].slice(-max) : [...buffer, ...items];
  return next;
}
