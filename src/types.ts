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
  | { type: 'state'; entityId: string; to?: EntityStateValue; from?: EntityStateValue; for?: number; id?: string }
  | { type: 'numeric_state'; entityId: string; above?: number; below?: number; id?: string }
  | { type: 'time'; at: string; id?: string } // "HH:MM"
  | { type: 'sun'; event: SunEvent; offsetMinutes?: number; id?: string }
  // Fase 3 (B9): una persona entra en una zona o sale de ella.
  | ZoneTrigger
  // Fase 3 (B9): evento de un mando (acción del sensor `*_action`: single, double, hold...).
  | DeviceActionTrigger;

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
  | { type: 'or'; conditions: Condition[] }
  // Fase 3 (B11): ninguna de las condiciones se cumple.
  | NotCondition
  // Fase 3 (B9): la persona está en la zona.
  | ZoneCondition
  // Tanda 1: el disparo vino de uno de estos disparadores (por su `id`).
  | TriggerCondition;

export type Action =
  | ServiceAction
  | { type: 'scene'; sceneId: Id }
  | { type: 'script'; scriptId: Id }
  | { type: 'delay'; seconds: number }
  // Fase 3 (B11): lógica de scripts de HA.
  | ChooseAction
  | IfAction
  | WaitForTriggerAction
  | RepeatAction
  | NotifyAction
  | VariablesAction;

/**
 * Destinos adicionales de una llamada a servicio (`target:` de HA con varias entidades o áreas).
 * `entityId` de la acción sigue siendo el destino principal; estos se suman a él.
 */
export interface ServiceTargets {
  entityIds?: string[];
  /** Ids de sala (Room.id): equivalen al `area_id` de HA. */
  areaIds?: Id[];
}

export interface ServiceAction {
  type: 'service';
  service: string;
  /** Destino principal ('' si no tiene, p. ej. notify.* o una acción solo con áreas). */
  entityId: string;
  data?: Record<string, EntityStateValue>;
  /** Tanda 1: más entidades y áreas de destino. */
  targets?: ServiceTargets;
}

/** Tanda 1: `condition: trigger`. Se cumple si el disparo vino de un disparador con uno de esos `id`. */
export interface TriggerCondition {
  type: 'trigger';
  ids: string[];
}

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

/** `id`: id del disparador (el suyo o, como en HA, su posición si no tiene). */
export type TraceTrigger = { index: number; description: string; id?: string } | { manual: true };

export interface TraceCondition {
  index: number;
  description: string;
  result: boolean;
  detail: string;
  /** Subcondiciones de and/or, con su propio resultado. */
  children?: TraceCondition[];
}

export type TraceActionStatus = 'done' | 'waiting' | 'skipped' | 'error';

export interface TraceAction {
  index: number;
  description: string;
  status: TraceActionStatus;
  /** Hora simulada en que se ejecutó (en una espera, la hora en que empezó a esperar). */
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
  | { kind: 'state_for'; entityId: string; automationId: Id; triggerIndex: number }
  // Fase 3 (B22): llamada a servicio retrasada por la latencia simulada.
  | ServiceCallTimer
  // Fase 3 (B11): `for:` de un disparador de estado dentro de wait_for_trigger.
  | WaitForTimer;

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
  /** Si es una notificación (notify.persistent_notification), su contenido. */
  notification?: { title?: string; message: string };
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

// ---- Fase 3 ----
// Tipos nuevos de la Fase 3. Los campos opcionales que se añaden a interfaces existentes
// (Project, Device, Floor, SimulationState, PendingAction, LogEntry) se declaran aquí por
// fusión de interfaces de TypeScript, para no tocar sus definiciones originales.

// B9: personas y zonas

export interface Person {
  id: Id;
  name: string;
  /** Color CSS para pintarla en la interfaz. */
  color?: string;
}

export type ZoneKind = 'home' | 'work' | 'other';

export interface Zone {
  id: Id;
  name: string;
  kind: ZoneKind;
  /** Centro de la zona (grados). La zona home toma por defecto los de Project.settings. */
  latitude?: number;
  longitude?: number;
  /** Radio en metros (10 a 50 000; por defecto 100 en la zona home). */
  radius?: number;
}

export interface ZoneTrigger {
  type: 'zone';
  personId: Id;
  zoneId: Id;
  event: 'enter' | 'leave';
  id?: string;
}

export interface DeviceActionTrigger {
  type: 'device_action';
  /** Sensor de acción del mando (sensor.<mando>_action). */
  entityId: string;
  /** Acción: 'single', 'double', 'hold'... */
  action: string;
  id?: string;
}

export interface ZoneCondition {
  type: 'zone';
  personId: Id;
  zoneId: Id;
}

// B11: más lógica

export interface NotCondition {
  type: 'not';
  conditions: Condition[];
}

export interface ChooseOption {
  conditions: Condition[];
  sequence: Action[];
}

export interface ChooseAction {
  type: 'choose';
  choices: ChooseOption[];
  /** Secuencia si no se cumple ninguna opción. */
  default?: Action[];
}

export interface IfAction {
  type: 'if';
  conditions: Condition[];
  then: Action[];
  else?: Action[];
}

export interface WaitForTriggerAction {
  type: 'wait_for_trigger';
  triggers: Trigger[];
  /** Segundos máximos de espera (sin valor: espera indefinida). */
  timeoutSeconds?: number;
  /** Si vence el tiempo: true (por defecto, como HA) sigue con las acciones; false las aborta. */
  continueOnTimeout?: boolean;
}

/** Repetición: exactamente una de count, while o until. */
export interface RepeatAction {
  type: 'repeat';
  count?: number;
  /** Repite mientras se cumplan (se evalúan antes de cada vuelta). */
  while?: Condition[];
  /** Repite hasta que se cumplan (se evalúan tras cada vuelta). */
  until?: Condition[];
  sequence: Action[];
}

export interface NotifyAction {
  type: 'notify';
  title?: string;
  message: string;
  /** Servicio de HA al exportar (por defecto notify.notify). */
  service?: string;
}

/** Variables simples; se sustituyen como {{ nombre }} en textos de notificaciones y datos de servicios. */
export interface VariablesAction {
  type: 'variables';
  variables: Record<string, EntityStateValue>;
}

export interface SimNotification {
  id: Id;
  /** Hora simulada (ms). */
  at: number;
  title: string;
  message: string;
  read: boolean;
}

/** Espera de un wait_for_trigger guardada en una PendingAction. */
export interface WaitState {
  triggers: Trigger[];
  continueOnTimeout: boolean;
  /** true si no hay tiempo límite (dueAt queda en WAIT_FOREVER). */
  forever?: boolean;
  /** Próxima hora (ms) a la que se cumple un disparador de hora o de sol de la espera. */
  timedAt?: number;
  /** Fin del tiempo límite (ms), si lo hay. */
  timeoutAt?: number;
}

/** Contexto de cada acción pendiente: variables visibles, bloque al que pertenece y vuelta de repeat. */
export interface PendingStep {
  scope?: Record<string, EntityStateValue>;
  block?: number;
  /** Vuelta siguiente de un repeat (la acción es la continuación del repeat). */
  repeatIndex?: number;
}

/** Disparador de estado con `for:` dentro de un wait_for_trigger, pendiente de confirmar. */
export interface WaitForTimer {
  kind: 'wait_for';
  entityId: string;
  /** Id de la PendingAction de la espera. */
  waitId: Id;
  triggerIndex: number;
}

// B13: entorno (modelo térmico e iluminancia)

export interface EnvironmentSettings {
  /** Activa el modelo térmico y de iluminancia en la simulación. */
  enabled: boolean;
  /** Temperatura exterior media diaria (°C). */
  outdoorMean: number;
  /** Amplitud de la oscilación diaria (°C). Máximo a las 15:00, mínimo a las 03:00. */
  outdoorAmplitude: number;
  /** Constante de tiempo de pérdidas con todo cerrado (horas). */
  tauHours?: number;
  /** Factor por el que se multiplican las pérdidas con una ventana abierta. */
  windowFactor?: number;
  /** Potencia de la calefacción/refrigeración en °C por hora. */
  hvacRatePerHour?: number;
}

export interface RoomEnvironment {
  temperature: number;
  illuminance: number;
}

export interface EnvironmentState {
  outdoorTemperature: number;
  rooms: Record<Id, RoomEnvironment>;
}

// B14: línea de tiempo

export type TimelineEventKind = 'state' | 'service' | 'motion' | 'button' | 'door' | 'person' | 'scene' | 'script';

export interface TimelineEventStep {
  /** "HH:MM" o "HH:MM:SS" relativo al día de inicio; si va antes que el paso previo, es del día siguiente. */
  at: string;
  kind: 'event';
  event: TimelineEventKind;
  entityId?: string;
  /** state: nuevo estado; button: acción; door: true abre, false cierra. */
  value?: EntityStateValue;
  service?: string;
  data?: Record<string, EntityStateValue>;
  personId?: Id;
  /** person: zona destino (sin valor o '' = fuera de casa). */
  zoneId?: Id;
  sceneId?: Id;
  scriptId?: Id;
}

export type AssertOp = 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte';

export interface TimelineAssertStep {
  at: string;
  kind: 'assert';
  entityId: string;
  expect: EntityStateValue;
  /** Por defecto 'eq'. */
  op?: AssertOp;
  /** Compara este atributo en lugar del estado. */
  attribute?: string;
}

export type TimelineStep = TimelineEventStep | TimelineAssertStep;

export interface Timeline {
  id: Id;
  name: string;
  steps: TimelineStep[];
  /** Fecha y hora simuladas de inicio (ms), guardadas al grabar o crear la prueba. */
  startAt?: number;
}

/** Evento de usuario anotado en el registro (para recordTimeline). */
export type RecordedEvent =
  | { kind: 'state'; entityId: string; value: EntityStateValue }
  | { kind: 'service'; entityId: string; service: string; data?: Record<string, EntityStateValue> }
  /** Evento físico con efectos propios (autoapagado del movimiento, pulsación y vuelta a reposo). */
  | { kind: 'physical'; event: 'motion' | 'button' | 'door'; entityId: string; value?: EntityStateValue }
  /** Persona que cambia de zona (zoneId null: fuera de casa). */
  | { kind: 'person'; personId: Id; zoneId: Id | null };

// B17: variantes

export interface ProjectVariant {
  id: Id;
  name: string;
  snapshot: Omit<Project, 'variants'>;
}

// B19: grupos

export type GroupDomain = 'light' | 'switch' | 'cover';

export interface EntityGroup {
  id: Id;
  name: string;
  domain: GroupDomain;
  entityIds: string[];
}

// B21: paredes

export type WallMaterial = 'drywall' | 'brick' | 'concrete' | 'glass';

export interface Wall {
  a: Point;
  b: Point;
  material: WallMaterial;
}

// B22: latencia y fiabilidad

export interface ReliabilitySettings {
  /** Aplica la latencia simulada por integración (nube 1-3 s, local ~100 ms). */
  latency: boolean;
  /** Probabilidad (0-1) de que falle una llamada a un servicio en la nube. */
  failureRate?: number;
  /** Semilla del generador pseudoaleatorio (determinista). */
  seed?: number;
}

export interface ServiceCallTimer {
  kind: 'service_call';
  entityId: string;
  /** "dominio.servicio" */
  service: string;
  data?: ServiceData;
  automationId?: Id;
}

// B23: historial

export interface HistorySample {
  /** Hora simulada (ms). */
  t: number;
  /** Estado (texto o número). */
  v: string | number;
}

// ---- Ampliaciones de interfaces existentes (fusión de declaraciones) ----

export interface Project {
  /**
   * Tanda 1: revisión del guardado (sube en cada guardado con saveProjectChecked). Sin valor
   * equivale a 0 (proyectos anteriores).
   */
  revision?: number;
  /** B9 */
  people?: Person[];
  zones?: Zone[];
  /** B13 */
  environment?: EnvironmentSettings;
  /** B14 */
  timelines?: Timeline[];
  /** B17 */
  variants?: ProjectVariant[];
  /** B19 */
  groups?: EntityGroup[];
  /** B22 */
  reliability?: ReliabilitySettings;
}

export interface Device {
  /** B19: «Mostrar relé como luz»: cambia el dominio de la entidad principal (switch ↔ light). */
  showAs?: 'light' | 'switch';
}

export interface Floor {
  /** B21: paredes como segmentos en coordenadas del lienzo. */
  walls?: Wall[];
}

export interface SimulationState {
  /** B11: bandeja de notificaciones. */
  notifications?: SimNotification[];
  /** B13: temperatura e iluminancia por sala. */
  environment?: EnvironmentState;
  /** B23: muestras por entidad. */
  history?: Record<string, HistorySample[]>;
  /** B22: estado del generador pseudoaleatorio. */
  rngState?: number;
}

export interface PendingAction {
  /** B11: wait_for_trigger en curso. */
  wait?: WaitState;
  /** B11: variables de la ejecución. */
  variables?: Record<string, EntityStateValue>;
  /**
   * B11 + trazas: paso de la traza de cada acción de `actions` cuando no son consecutivos desde
   * traceOffset (espera dentro de un choose/if/repeat: las acciones hijas comparten el paso de
   * su padre, que es traceOffset - 1).
   */
  traceIndexes?: number[];
  /** Variables, bloque y vuelta de repeat de cada acción de `actions` (ámbito de variables). */
  steps?: PendingStep[];
}

export interface LogEntry {
  /** B14: evento de usuario (setEntityState/callService desde fuera). */
  event?: RecordedEvent;
  /** B14: cambio de estado registrado. */
  change?: { from: EntityStateValue; to: EntityStateValue };
}
