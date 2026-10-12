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

/** Modos de color de una luz (subconjunto de los de HA). */
export type ColorMode = 'onoff' | 'brightness' | 'color_temp' | 'rgb';

/**
 * Capacidades de una entidad (catálogo). Todas opcionales: si faltan, el motor usa valores
 * por defecto razonables por dominio (ver src/devices/capabilities.ts).
 */
export interface EntityCapabilities {
  /** light: modos admitidos. Sin 'brightness' no se regula; sin 'rgb' no admite color. */
  colorModes?: ColorMode[];
  /** light: rango de temperatura de color en kelvin. */
  minKelvin?: number;
  maxKelvin?: number;
  /** climate: modos HVAC admitidos ('off', 'heat', 'cool', 'auto', 'heat_cool'...). */
  hvacModes?: string[];
  /** climate: presets ('eco', 'away', 'comfort', 'boost'...). */
  presetModes?: string[];
  /** climate: límites y paso de la consigna en °C. */
  minTemp?: number;
  maxTemp?: number;
  tempStep?: number;
  /** cover: segundos para recorrer del 0 al 100 %. */
  travelSeconds?: number;
  /** binary_sensor de movimiento: segundos hasta volver a 'off' sin nuevo movimiento. */
  motionTimeoutSeconds?: number;
  /** switch/light: potencia nominal de la carga o máxima del enchufe, en vatios. */
  powerWatts?: number;
  /** media_player: fuentes seleccionables. */
  sources?: string[];
  /** sensor de acción de un mando: acciones posibles ('single', 'double', 'hold'...). */
  buttonActions?: string[];
}

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
  capabilities?: EntityCapabilities;
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
  /** Precio orientativo (PVP en España, 2025-26) en euros. */
  priceEur?: number;
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
  /** Alimentado por un SAI: sigue funcionando durante un corte de luz. */
  ups?: boolean;
  /** Carga conectada (enchufes y relés) en vatios, para el cálculo de energía. */
  loadWatts?: number;
}

export interface Connection {
  id: Id;
  sourceId: Id;
  targetId: Id;
  protocol: Protocol;
}

// ---------- Automatizaciones ----------

export type Trigger =
  /** `for`: segundos que el nuevo estado debe mantenerse antes de disparar. */
  | { type: 'state'; entityId: string; to?: EntityStateValue; from?: EntityStateValue; for?: number }
  | { type: 'numeric_state'; entityId: string; above?: number; below?: number }
  | { type: 'time'; at: string } // "HH:MM"
  | { type: 'sun'; event: SunEvent; offsetMinutes?: number };

export type SunEvent = 'sunrise' | 'sunset';

export type Condition =
  /** `for`: segundos mínimos que la entidad lleva en ese estado. */
  | { type: 'state'; entityId: string; state: EntityStateValue; for?: number }
  | { type: 'numeric_state'; entityId: string; above?: number; below?: number }
  | { type: 'time'; after?: string; before?: string }
  /**
   * Posición del sol (como `condition: sun` de HA). Si after es posterior a before en el mismo
   * día (p. ej. after: sunset, before: sunrise) se interpreta como franja que cruza la medianoche.
   */
  | {
      type: 'sun';
      after?: SunEvent;
      afterOffsetMinutes?: number;
      before?: SunEvent;
      beforeOffsetMinutes?: number;
    }
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

/** Ajustes del proyecto: ubicación (sol real), precios y energía. */
export interface ProjectSettings {
  latitude: number;
  longitude: number;
  /** Zona horaria IANA (p. ej. "Europe/Madrid") para pasar el amanecer/atardecer a hora local. */
  timeZone?: string;
  /** Precio de la electricidad en €/kWh. */
  electricityPriceEurKwh: number;
  currency?: 'EUR';
  /** Precios propios por definitionId; tienen prioridad sobre los del catálogo. */
  prices?: Record<Id, number>;
  /** Factor de aceleración de la descarga de las baterías (1 = realista). */
  batteryAcceleration?: number;
}

/** Ajustes por defecto: Madrid, 0,15 €/kWh. */
export function defaultSettings(): ProjectSettings {
  return {
    latitude: 40.4168,
    longitude: -3.7038,
    timeZone: 'Europe/Madrid',
    electricityPriceEurKwh: 0.15,
    currency: 'EUR',
    batteryAcceleration: 1,
  };
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
  settings?: ProjectSettings;
}

// ---------- Simulación ----------

export type EntityStateValue = string | number | boolean;

/**
 * Datos de una llamada a servicio. Admite listas numéricas (rgb_color: [255, 0, 0]).
 * En `Action.data` y en los atributos de estado, rgb_color se guarda como texto "[255, 0, 0]"
 * (EntityStateValue) para no cambiar esos tipos; el YAML lo exporta como lista.
 */
export type ServiceDataValue = EntityStateValue | number[];
export type ServiceData = Record<string, ServiceDataValue>;

export interface EntityState {
  state: EntityStateValue;
  attributes?: Record<string, EntityStateValue>;
  /** Hora simulada (ms) del último cambio de `state` (last_changed de HA). Sin valor: desde el inicio. */
  lastChanged?: number;
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
  /**
   * Dispositivos simulados como desconectados: deviceId -> estado de sus entidades antes del
   * fallo, para restaurarlo al recuperarse.
   */
  offline?: Record<Id, Record<string, EntityState>>;
  /** Hora simulada de creación: last_changed por defecto de las entidades que no han cambiado. */
  startedAt?: number;
  /** Fallos simulados (Internet, corte de luz, HA reiniciando, dispositivos caídos). */
  failures?: Failures;
  /** Dispositivos que están offline por los fallos (no a mano): setFailures los restaura. */
  failureOffline?: Id[];
  /** Trazas de las últimas ejecuciones (como mucho 50 por automatización). */
  traces?: AutomationTrace[];
  /** Energía acumulada desde `since` (hora simulada). */
  energy?: EnergyState;
  /** Nivel de batería (0-100, con decimales) por dispositivo a pilas. */
  batteries?: Record<Id, number>;
}

export interface Failures {
  internet: boolean;
  powerOutage: boolean;
  haRestarting: boolean;
  devicesDown: Id[];
}

export interface EnergyState {
  kwhByDevice: Record<Id, number>;
  since: number;
}

// ---------- Trazas ----------

export type TraceTrigger = { index: number; description: string } | { manual: true };

export interface TraceCondition {
  index: number;
  description: string;
  result: boolean;
  detail: string;
}

export type TraceActionStatus = 'done' | 'waiting' | 'skipped' | 'error';

export interface TraceAction {
  index: number;
  description: string;
  status: TraceActionStatus;
  /** Hora simulada en que se ejecutó (o se ejecutará, si espera). */
  at?: number;
  detail?: string;
}

export type TraceResult = 'ran' | 'conditions_failed' | 'skipped_single' | 'queued' | 'error' | 'ha_unavailable';

export interface AutomationTrace {
  id: Id;
  automationId: Id;
  startedAt: number;
  trigger: TraceTrigger;
  conditions: TraceCondition[];
  actions: TraceAction[];
  result: TraceResult;
}

/** Temporizador interno del motor (no es una espera de una automatización). */
export type SimTimer =
  /** Fija estados al vencer (p. ej. autoapagado del movimiento). */
  | { kind: 'set_states'; setStates: Record<string, EntityState>; reason?: string }
  /** Siguiente paso del recorrido de una persiana hacia `target` (0-100). */
  | { kind: 'cover_step'; entityId: string; target: number }
  /** Disparador de estado con `for:` pendiente de confirmar. */
  | { kind: 'state_for'; entityId: string; automationId: Id; triggerIndex: number };

export interface PendingAction {
  id: Id;
  dueAt: number;
  automationId?: Id;
  scriptId?: Id;
  actions: Action[];
  /** Si existe, es un temporizador interno: `actions` va vacío y no cuenta como espera. */
  timer?: SimTimer;
  /** Clave única del temporizador: uno nuevo con la misma clave sustituye al anterior. */
  key?: string;
  /** Traza a la que pertenecen estas acciones y posición de la primera en la automatización. */
  traceId?: Id;
  traceOffset?: number;
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
