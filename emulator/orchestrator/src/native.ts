// Vías reales del laboratorio (E2): Z-Wave JS con el mock de zwave-js y ESPHome con la API nativa.
// El Lab les pasa el proyecto, los estados y qué dispositivos deben estar caídos; ellas avisan de
// los comandos de HA, del tráfico y de su estado.
import type { DeviceDefinition, EntityState, Id, Project } from '../../../src/types';
import type { BridgeCommand } from '../../../src/bridge/mqtt/commands';
import type { NativeTransport } from '../../../src/bridge/native';
import type { NativeStatus, TrafficDirection, TrafficVia } from '../../../src/bridge/protocol';
import type { AlignTarget } from './haNative';

export interface NativeContext {
  project: Project;
  defs: DeviceDefinition[];
  entities: Readonly<Record<string, EntityState>>;
  /** Dispositivos de esta vía que llegan a HA por ella (los demás siguen por MQTT). */
  devices: ReadonlySet<Id>;
  /** Dispositivos caídos: nodos parados o no disponibles en el simulador (fallos, batería...). */
  down: ReadonlySet<Id>;
  /**
   * Hay una app en vivo (el mundo físico existe). Si no, todos los nodos se paran, pero el
   * controlador Z-Wave sigue en marcha (no se reinicia el driver de Z-Wave JS UI).
   */
  live: boolean;
}

export interface NativeEvents {
  /** Comando de HA para un dispositivo (el Lab lo reenvía a la app si el nodo está en marcha). */
  command: (deviceId: Id, command: BridgeCommand, label: string) => void;
  traffic: (entry: { dir: TrafficDirection; topic: string; payload: string; deviceId?: Id; via: TrafficVia }) => void;
  /** El estado de la vía ha cambiado (el Lab vuelve a mandar `status`). */
  changed: () => void;
  log: (msg: string) => void;
}

export interface NativeBackend {
  readonly transport: NativeTransport;
  start(events: NativeEvents): Promise<void>;
  /** Reconcilia con el proyecto: crea, actualiza, para o borra nodos y publica los estados. */
  sync(ctx: NativeContext): Promise<void>;
  status(): NativeStatus;
  /** Entidades ya creadas en HA que deben llevar el entity_id del simulador. */
  alignTargets(): AlignTarget[];
  /** Tras restaurar un snapshot: olvida lo que tiene en memoria (claves, red) y vuelve a leerlo. */
  reset?(): Promise<void>;
  close(): Promise<void>;
}
