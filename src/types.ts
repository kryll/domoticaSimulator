// Modelo de datos de HA Simulator. Fuente de verdad compartida por todos los módulos.

export type Id = string;

// ---------- Dominio ----------

export type Protocol =
  | 'wifi'
  | 'ethernet'
  | 'zigbee'
  | 'zwave'
  | 'thread'
  | 'matter'
  | 'ble'
  | 'rf433';

export type Integration =
  | 'zha'
  | 'zigbee2mqtt'
  | 'matter'
  | 'homekit_device'
  | 'xiaomi_miio'
  | 'tuya'
  | 'ewelink'
  | 'shelly'
  | 'hue'
  | 'google_cast'
  | 'alexa_media_player'
  // Integraciones oficiales de HA añadidas por el backend: sin ellas no se pueden
  // modelar con realismo Z-Wave, sensores BLE de Xiaomi, Netatmo, Reolink, Sonos,
  // televisores Samsung/LG y enchufes TP-Link.
  | 'zwave_js'
  | 'xiaomi_ble'
  | 'netatmo'
  | 'reolink'
  | 'sonos'
  | 'samsungtv'
  | 'webostv'
  | 'tplink'
  // Integración propia del servidor Home Assistant (no es un dispositivo de terceros).
  | 'homeassistant';

export type Brand =
  | 'IKEA'
  | 'SONOFF'
  | 'Aqara'
  | 'Xiaomi'
  | 'Shelly'
  | 'Philips Hue'
  | 'Amazon'
  | 'Google'
  | 'Tuya'
  | 'TP-Link'
  | 'Netatmo'
  | 'Reolink'
  | 'Sonos'
  | 'Samsung'
  | 'LG'
  // Nabu Casa: servidor Home Assistant Green y antenas Connect (Z-Wave/Zigbee).
  | 'Home Assistant';

/** Forma en que Home Assistant habla con la integración. */
export type IotClass = 'local_push' | 'local_polling' | 'cloud_push' | 'cloud_polling';

/** Dominio de entidad de Home Assistant. */
export type EntityDomain =
  | 'light'
  | 'switch'
  | 'sensor'
  | 'binary_sensor'
  | 'climate'
  | 'cover'
  | 'lock'
  | 'camera'
  | 'media_player'
  | 'fan'
  | 'vacuum'
  | 'button';

/** Papel del dispositivo dentro de la red. */
export type NetworkRole =
  | 'end_device' // dispositivo final (sensor a pilas, etc.)
  | 'router' // repite la malla (Zigbee router, Thread router)
  | 'coordinator' // coordinador Zigbee (dongle USB, SLZB-06...)
  | 'hub' // hub o puente propietario (Hue Bridge, Aqara Hub, DIRIGERA)
  | 'border_router' // border router Thread (HomePod, Nest Hub, Echo 4...)
  | 'access_point' // router Wi-Fi / punto de acceso
  | 'ha_server'; // servidor de Home Assistant

export type PowerSource = 'mains' | 'battery' | 'usb' | 'poe';

export interface EntityDefinition {
  /** Sufijo del entity_id, p. ej. "temperature" -> sensor.<nombre>_temperature */
  key: string;
  domain: EntityDomain;
  name: string;
  /** device_class de HA cuando aplica (temperature, motion, door...). */
  deviceClass?: string;
  unit?: string;
  /** Estado inicial en la simulación. */
  initialState: EntityStateValue;
}

/** Entrada del catálogo (data/devices.json). */
export interface DeviceDefinition {
  id: Id;
  brand: Brand;
  model: string;
  name: string;
  category: DeviceCategory;
  protocols: Protocol[];
  integrations: Integration[];
  iotClass: IotClass;
  role: NetworkRole;
  power: PowerSource;
  /** Si requiere un hub propietario, la marca cuyo hub lo satisface (Aqara, IKEA, Philips Hue). */
  requiresHub?: Brand;
  /** Alcance aproximado en metros para la cobertura. */
  rangeMeters?: number;
  entities: EntityDefinition[];
  icon?: string;
}

export type DeviceCategory =
  | 'light'
  | 'plug'
  | 'switch'
  | 'sensor'
  | 'climate'
  | 'cover'
  | 'lock'
  | 'camera'
  | 'speaker'
  | 'display'
  | 'vacuum'
  | 'hub'
  | 'network'
  | 'server';

// ---------- Proyecto ----------

export interface Point {
  x: number;
  y: number;
}

export interface Room {
  id: Id;
  floorId: Id;
  name: string;
  /** Polígono en coordenadas del lienzo (píxeles). */
  polygon: Point[];
}

export interface Floor {
  id: Id;
  name: string;
  level: number;
  /** Imagen de fondo del plano (data URL), opcional. */
  backgroundImage?: string;
  /** Escala del plano: píxeles por metro. */
  pixelsPerMeter: number;
}

export interface Device {
  id: Id;
  definitionId: Id;
  name: string;
  floorId: Id;
  roomId?: Id;
  position: Point;
  /** Protocolo elegido cuando el dispositivo soporta varios. */
  protocol: Protocol;
  integration: Integration;
}

export interface Connection {
  id: Id;
  sourceId: Id;
  targetId: Id;
  protocol: Protocol;
}

// ---------- Automatizaciones ----------

export type Trigger =
  | { type: 'state'; entityId: string; to?: EntityStateValue; from?: EntityStateValue }
  | { type: 'numeric_state'; entityId: string; above?: number; below?: number }
  | { type: 'time'; at: string } // "HH:MM"
  | { type: 'sun'; event: 'sunrise' | 'sunset'; offsetMinutes?: number };

export type Condition =
  | { type: 'state'; entityId: string; state: EntityStateValue }
  | { type: 'numeric_state'; entityId: string; above?: number; below?: number }
  | { type: 'time'; after?: string; before?: string }
  | { type: 'and'; conditions: Condition[] }
  | { type: 'or'; conditions: Condition[] };

export type Action =
  | { type: 'service'; service: string; entityId: string; data?: Record<string, EntityStateValue> }
  | { type: 'scene'; sceneId: Id }
  | { type: 'script'; scriptId: Id }
  | { type: 'delay'; seconds: number };

export interface Automation {
  id: Id;
  name: string;
  enabled: boolean;
  triggers: Trigger[];
  conditions: Condition[];
  actions: Action[];
  mode: 'single' | 'restart' | 'queued' | 'parallel';
}

export interface Scene {
  id: Id;
  name: string;
  /** entity_id -> estado objetivo */
  entities: Record<string, EntityState>;
}

export interface Script {
  id: Id;
  name: string;
  sequence: Action[];
}

export interface Project {
  id: Id;
  name: string;
  version: 1;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  floors: Floor[];
  rooms: Room[];
  devices: Device[];
  connections: Connection[];
  automations: Automation[];
  scenes: Scene[];
  scripts: Script[];
}

// ---------- Simulación ----------

export type EntityStateValue = string | number | boolean;

export interface EntityState {
  state: EntityStateValue;
  attributes?: Record<string, EntityStateValue>;
}

export interface SimulationState {
  running: boolean;
  /** Hora simulada, milisegundos desde epoch. */
  now: number;
  /** Factor de velocidad del reloj (1 = tiempo real). */
  speed: number;
  /** entity_id -> estado */
  entities: Record<string, EntityState>;
  /** Acciones con delay pendientes de ejecutar. */
  pending: PendingAction[];
  /** Ejecuciones encoladas de automatizaciones en modo 'queued' que esperan a que termine la anterior. */
  queue?: PendingAction[];
  log: LogEntry[];
}

export interface PendingAction {
  id: Id;
  dueAt: number;
  automationId?: Id;
  scriptId?: Id;
  actions: Action[];
}

export type LogLevel = 'info' | 'warning' | 'error';

export interface LogEntry {
  id: Id;
  timestamp: number;
  level: LogLevel;
  message: string;
  entityId?: string;
  automationId?: Id;
}

// ---------- Validador ----------

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  id: string;
  severity: IssueSeverity;
  /** Código estable, p. ej. "zigbee-sin-coordinador". */
  code: string;
  message: string;
  deviceIds: Id[];
}
