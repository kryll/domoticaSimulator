// Mensajes entre el orquestador y el servicio zwave-mock (WebSocket de control, solo en
// 127.0.0.1 y con el token del laboratorio). El orquestador manda siempre el estado deseado completo
// y el mock aplica las diferencias: es idempotente y aguanta reconexiones.
import type { ZwaveCcName, ZwaveCommand, ZwaveNodeValues, ZwaveValueKey } from '../../../../src/bridge/zwave/plan';

export interface MockNodeConfig {
  nodeId: number;
  name: string;
  location?: string;
  listening: boolean;
  genericDeviceClass: number;
  specificDeviceClass: number;
  multilevelAs?: 'light' | 'cover';
  ccs: ZwaveCcName[];
  /** Valores que tiene el nodo (qué escalas de Meter, qué sensores y qué notificaciones anuncia). */
  values: ZwaveValueKey[];
}

export interface MockConfig {
  homeId: number;
  nodes: MockNodeConfig[];
  /** Cada cuánto despiertan los nodos a pilas (segundos). */
  wakeUpSeconds: number;
}

export interface MockState {
  config: MockConfig;
  /** Valores por nodo (los del simulador traducidos a Z-Wave). */
  values: Record<number, ZwaveNodeValues>;
  /** Nodos parados: no responden (Z-Wave JS los marca dead) ni mandan informes. */
  down: number[];
  /** Controlador en marcha: si no, el puerto serie (TCP) se cierra y todo queda no disponible. */
  controllerUp: boolean;
}

export type ToMock = { type: 'hello'; token: string } | { type: 'state'; state: MockState };

export type FromMock =
  | { type: 'ready'; version: string }
  | { type: 'status'; client: boolean; listening: boolean; nodes: number }
  | { type: 'command'; nodeId: number; command: ZwaveCommand }
  | { type: 'frame'; dir: 'in' | 'out'; nodeId: number; summary: string }
  | { type: 'error'; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseToMock(text: string): ToMock {
  const raw: unknown = JSON.parse(text);
  if (!isObj(raw)) throw new Error('mensaje no válido');
  if (raw.type === 'hello' && typeof raw.token === 'string') return { type: 'hello', token: raw.token };
  if (raw.type === 'state' && isObj(raw.state) && isObj(raw.state.config) && Array.isArray(raw.state.config.nodes) && Array.isArray(raw.state.down) && isObj(raw.state.values)) {
    return raw as unknown as ToMock;
  }
  throw new Error(`mensaje desconocido: ${String(raw.type)}`);
}

export function parseFromMock(text: string): FromMock | undefined {
  try {
    const raw: unknown = JSON.parse(text);
    if (!isObj(raw) || typeof raw.type !== 'string') return undefined;
    if (['ready', 'status', 'command', 'frame', 'error'].includes(raw.type)) return raw as unknown as FromMock;
    return undefined;
  } catch {
    return undefined;
  }
}
