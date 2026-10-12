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
  | 'homeassistant'
  // Tanda 3: catálogo ampliado.
  | 'esphome'
  | 'daikin_onecta'
  | 'sensibo'
  | 'meross_lan'
  | 'roborock'
  | 'ecovacs';

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
  | 'Home Assistant'
  // Tanda 3: catálogo ampliado.
  | 'Eve'
  | 'Nanoleaf'
  | 'Heiman'
  | 'Daikin'
  | 'Sensibo'
  | 'Meross'
  | 'Roborock'
  | 'Ecovacs'
  | 'Aeotec'
  | 'Fibaro'
  | 'Zooz'
  | 'ESPHome';

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
  | 'button'
  // Tanda 3: alarma y válvulas.
  | 'alarm_control_panel'
  | 'valve';

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

export type Trigger = (
  /** `for`: segundos que el nuevo estado debe mantenerse antes de disparar. */
  | { type: 'state'; entityId: string; to?: EntityStateValue; from?: EntityStateValue; for?: number; id?: string }
  /** Tanda 3: `for`, segundos que el valor debe seguir dentro del rango. */
  | { type: 'numeric_state'; entityId: string; above?: number; below?: number; id?: string; for?: number }
  | { type: 'time'; at: string; id?: string } // "HH:MM"
  | { type: 'sun'; event: SunEvent; offsetMinutes?: number; id?: string }
  // Fase 3 (B9): una persona entra en una zona o sale de ella.
  | ZoneTrigger
  // Fase 3 (B9): evento de un mando (acción del sensor `*_action`: single, double, hold...).
  | DeviceActionTrigger
  // Tanda 3: patrón de hora, arranque/parada de HA y eventos.
  | TimePatternTrigger
  | HomeAssistantTrigger
  | EventTrigger
) &
  StepToggle;

export type SunEvent = 'sunrise' | 'sunset';

export type Condition = (
  /** `for`: segundos mínimos que la entidad lleva en ese estado. */
  | { type: 'state'; entityId: string; state: EntityStateValue; for?: number }
  | { type: 'numeric_state'; entityId: string; above?: number; below?: number }
  /** Tanda 3: `weekday`, días de la semana en que se cumple (sin valor: todos). */
  | { type: 'time'; after?: string; before?: string; weekday?: Weekday[] }
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
  | TriggerCondition
) &
  StepToggle;

export type Action = (
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
  | VariablesAction
  // Tanda 3: detener la secuencia y ramas en paralelo.
  | StopAction
  | ParallelAction
) &
  ActionFlags;

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
  /** Tanda 2: datos del presupuesto y de la propuesta para el cliente. */
  quote?: QuoteSettings;
}

/** Tanda 2: ajustes del presupuesto por partidas (todas opcionales; ver src/report/quote.ts). */
export interface QuoteSettings {
  clientName?: string;
  clientAddress?: string;
  installerName?: string;
  /** Horas de mano de obra adicionales (se suman a las estimadas). 0-1000. */
  laborHours?: number;
  /** Precio de la hora de mano de obra en €/h (por defecto 45). 0-1000. */
  laborRateEurH?: number;
  /** Minutos de instalación por dispositivo; si se indica, sustituye a la estimación por tipo. 0-600. */
  perDeviceInstallMinutes?: number;
  /** Margen sobre materiales y mano de obra en % (por defecto 0). 0-100. */
  marginPct?: number;
  /** Descuento en % (por defecto 0). 0-100. */
  discountPct?: number;
  /** IVA en % (por defecto 21). 0-100. */
  vatPct?: number;
  /** Días de validez de la oferta (por defecto 30). 1-365. */
  validityDays?: number;
  notes?: string;
  /** Modo presentación: oculta los precios. */
  hidePrices?: boolean;
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
  | WaitForTimer
  // Tanda 3: fin de un helper timer.
  | HelperTimerTimer;

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
  /** Código estable, p. ej. "zigbee-sin-coordinador". Es un dato: no se muestra al usuario. */
  code: string;
  /**
   * Tanda 2: título corto y legible («Falta el coordinador Zigbee»). El validador lo rellena
   * siempre; es opcional para no romper incidencias creadas a mano (usa issueTitle()).
   */
  title?: string;
  message: string;
  deviceIds: Id[];
  /** Tanda 2: elemento al que se refiere la incidencia (para los arreglos rápidos). */
  ref?: IssueRef;
}

/** Tanda 2: referencia estructurada de una incidencia (automatización, escena, script, conexión...). */
export interface IssueRef {
  kind: 'automation' | 'scene' | 'script' | 'connection' | 'group';
  id: Id;
  entityId?: string;
  service?: string;
  /** Nombre del script o slug compartido (nombre-script-duplicado). */
  slug?: string;
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

// ---- Tanda 3 ----
// Paridad con HA: helpers, más disparadores/condiciones/acciones, dispositivos personalizados,
// alarma y válvulas. Los campos nuevos de interfaces existentes se añaden por fusión.

/** Activa o desactiva un paso (disparador, condición o acción), como `enabled: false` en HA. */
export interface StepToggle {
  /** false: el paso se ignora (disparador que no dispara, condición que se da por cumplida, acción que se salta). */
  enabled?: boolean;
}

/** Opciones de cualquier acción. */
export interface ActionFlags extends StepToggle {
  /** Si la acción falla, se sigue con la siguiente en lugar de detener la secuencia. */
  continueOnError?: boolean;
}

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/**
 * Patrón de hora (`trigger: time_pattern`). Cada campo admite un número ("5"), "*" o "/5" (cada
 * 5). Sin valor: si se indica una unidad mayor, las menores valen 0; si no, cualquiera.
 */
export interface TimePatternTrigger {
  type: 'time_pattern';
  hours?: string;
  minutes?: string;
  seconds?: string;
  id?: string;
}

/** Arranque o parada de Home Assistant (`trigger: homeassistant`). */
export interface HomeAssistantTrigger {
  type: 'homeassistant';
  event: 'start' | 'shutdown';
  id?: string;
}

/** Evento del bus de HA (`trigger: event`), p. ej. timer.finished o zha_event. */
export interface EventTrigger {
  type: 'event';
  eventType: string;
  /** Datos que debe contener el evento (comparación por igualdad de cada clave). */
  eventData?: Record<string, EntityStateValue>;
  id?: string;
}

/** Detiene la secuencia (`stop:`); con `error` la ejecución termina con error. */
export interface StopAction {
  type: 'stop';
  message: string;
  error?: boolean;
}

/** Ramas que se ejecutan a la vez (`parallel:`); la secuencia sigue cuando terminan todas. */
export interface ParallelAction {
  type: 'parallel';
  branches: Action[][];
}

// Helpers de HA (input_*, timer, counter)

export type HelperType = 'input_boolean' | 'input_number' | 'input_select' | 'input_text' | 'input_datetime' | 'timer' | 'counter';

interface HelperBase {
  id: Id;
  name: string;
  /** Icono de HA (mdi:...). */
  icon?: string;
}

export interface InputBooleanHelper extends HelperBase {
  type: 'input_boolean';
  initial?: boolean;
}

export interface InputNumberHelper extends HelperBase {
  type: 'input_number';
  min: number;
  max: number;
  step: number;
  mode: 'slider' | 'box';
  unit?: string;
  initial?: number;
}

export interface InputSelectHelper extends HelperBase {
  type: 'input_select';
  options: string[];
  initial?: string;
}

export interface InputTextHelper extends HelperBase {
  type: 'input_text';
  /** Longitud máxima (por defecto 100, como HA). */
  max?: number;
  initial?: string;
}

export interface InputDatetimeHelper extends HelperBase {
  type: 'input_datetime';
  has_date: boolean;
  has_time: boolean;
  /** "AAAA-MM-DD", "HH:MM:SS" o "AAAA-MM-DD HH:MM:SS" según has_date/has_time. */
  initial?: string;
}

export interface TimerHelper extends HelperBase {
  type: 'timer';
  /** Duración por defecto en segundos. */
  duration: number;
}

export interface CounterHelper extends HelperBase {
  type: 'counter';
  initial: number;
  step: number;
  minimum?: number;
  maximum?: number;
}

export type Helper =
  | InputBooleanHelper
  | InputNumberHelper
  | InputSelectHelper
  | InputTextHelper
  | InputDatetimeHelper
  | TimerHelper
  | CounterHelper;

/** Fin de un helper timer: pasa a idle y lanza el evento timer.finished. */
export interface HelperTimerTimer {
  kind: 'helper_timer';
  entityId: string;
}

/** Ramas de un `parallel` pendientes: la continuación se ejecuta cuando terminan todas. */
export interface ParallelJoin {
  remaining: number;
  /** Acciones que siguen al `parallel` (con su traza y su ámbito). */
  cont: PendingAction;
}

export interface Project {
  /** Tanda 3: helpers (input_boolean, input_number, input_select, input_text, input_datetime, timer, counter). */
  helpers?: Helper[];
  /** Tanda 3: definiciones de dispositivos propias (id con el prefijo «custom:»). */
  customDefinitions?: DeviceDefinition[];
}

export interface Device {
  /** Tanda 3: código de la alarma (alarm_control_panel). Sin valor: «1234». */
  alarmCode?: string;
}

export interface EntityCapabilities {
  /** Tanda 3: climate, modos del ventilador ('auto', 'low', 'medium', 'high'). */
  fanModes?: string[];
  /** Tanda 3: alarm_control_panel, modos de armado admitidos ('armed_home', 'armed_away', 'armed_night'...). */
  alarmModes?: string[];
  /** Tanda 3: alarm_control_panel, pide el código también para armar. */
  codeArmRequired?: boolean;
}

export interface PendingAction {
  /** Tanda 3: rama de un `parallel` (id de la unión en SimulationState.joins). */
  join?: Id;
}

export interface SimulationState {
  /** Tanda 3: uniones de ramas `parallel` pendientes. */
  joins?: Record<Id, ParallelJoin>;
}

// ---- Emulación ----
// Entorno emulado con un Home Assistant real (docs/EMULACION.md, tanda E1). Bloque propio del
// puente (src/bridge, emulator/): los campos que se añaden a Project van por fusión de interfaces.
// Los secretos (contraseñas MQTT, tokens de HA) NUNCA van en Project: viven en emulator/.env y
// emulator/.secrets/, fuera de la app.

/** Dónde se ejecutan las automatizaciones con el puente activo (solo en un sitio). */
export type AutomationsRunIn = 'home_assistant' | 'simulator';

/** Ajustes del puente con el entorno emulado (sin secretos). */
export interface HaBridgeSettings {
  enabled: boolean;
  /** WebSocket del orquestador, p. ej. ws://localhost:8080/orchestrator. */
  orchestratorUrl: string;
  /** Prefijo de discovery de MQTT en HA (por defecto 'homeassistant'). */
  discoveryPrefix: string;
  /** Topic base del perfil MQTT genérico (por defecto 'hasim'). */
  baseTopic: string;
  /** Topic base del Zigbee2MQTT emulado (por defecto 'hasim-z2m'). */
  z2mBaseTopic: string;
  automationsRunIn: AutomationsRunIn;
}

export function defaultHaBridgeSettings(): HaBridgeSettings {
  return {
    enabled: false,
    orchestratorUrl: 'ws://localhost:8080/orchestrator',
    discoveryPrefix: 'homeassistant',
    baseTopic: 'hasim',
    z2mBaseTopic: 'hasim-z2m',
    automationsRunIn: 'home_assistant',
  };
}

/** Disponibilidad modelada de un protocolo (cuándo HA da el dispositivo por perdido). */
export interface RadioAvailability {
  /** Segundos sin noticias para un dispositivo alimentado (Zigbee: 10 min). */
  activeSeconds?: number;
  /** Segundos sin noticias para un dispositivo a pilas (Zigbee: 25 h). */
  batterySeconds?: number;
  /** Thread: timeout del hijo. */
  childTimeoutSeconds?: number;
  /** Matter: intervalo mínimo de la suscripción. */
  subscriptionSeconds?: number;
  /** Z-Wave: fallos seguidos hasta marcarlo «dead». */
  deadAfterFailures?: number;
  /** Z-Wave: intervalo de despertar de los dispositivos a pilas. */
  wakeUpSeconds?: number;
  /** Wi-Fi/ESPHome/Shelly: ping de la API. */
  pingSeconds?: number;
  /** BLE: segundos sin anuncios hasta darlo por perdido. */
  noAdvertSeconds?: number;
  /** RF 433: sin estado, nunca se marca como no disponible. */
  never?: boolean;
}

/** Perfil de radio configurable por protocolo (valores por defecto en defaultRadioProfiles). */
export interface RadioProfile {
  /** Latencia por salto (ms). */
  latencyMs: number;
  /** Latencia extra si hay reintento (ms). */
  retryLatencyMs?: number;
  /** Pérdida de tramas en %. */
  lossPct: number;
  /** El protocolo no confirma la recepción (RF 433). */
  noAck?: boolean;
  maxHops?: number;
  /** Z-Wave Long Range: saltos máximos. */
  longRangeMaxHops?: number;
  maxChildrenCoordinator?: number;
  maxChildrenRouter?: number;
  /** Thread: hijos por padre. Wi-Fi: clientes por punto de acceso. */
  maxChildrenPerParent?: number;
  channel?: number;
  channelMin?: number;
  channelMax?: number;
  /** Canales habituales (Wi-Fi 1/6/11, BLE 37/38/39). */
  channels?: number[];
  frequencyMhz?: number;
  /** BLE: intervalo de anuncio [mín, máx] en segundos. */
  advertIntervalSeconds?: [number, number];
  availability: RadioAvailability;
}

/** Perfiles de radio por defecto (tabla de docs/EMULACION.md). */
export function defaultRadioProfiles(): Record<Protocol, RadioProfile> {
  const wifi: RadioProfile = { latencyMs: 20, lossPct: 0.5, maxChildrenPerParent: 30, channels: [1, 6, 11], channel: 6, availability: { pingSeconds: 60 } };
  return {
    zigbee: {
      latencyMs: 15,
      retryLatencyMs: 40,
      lossPct: 1,
      maxHops: 5,
      maxChildrenCoordinator: 20,
      maxChildrenRouter: 16,
      channel: 11,
      channelMin: 11,
      channelMax: 26,
      availability: { activeSeconds: 600, batterySeconds: 25 * 3600 },
    },
    thread: { latencyMs: 10, lossPct: 0.5, maxHops: 6, maxChildrenPerParent: 10, channel: 15, channelMin: 11, channelMax: 26, availability: { childTimeoutSeconds: 240 } },
    matter: { latencyMs: 20, lossPct: 0.2, availability: { subscriptionSeconds: 60 } },
    zwave: { latencyMs: 30, lossPct: 1, maxHops: 4, longRangeMaxHops: 1, frequencyMhz: 868.4, availability: { deadAfterFailures: 3, wakeUpSeconds: 3600 } },
    wifi,
    ethernet: { latencyMs: 5, lossPct: 0, availability: { pingSeconds: 60 } },
    ble: { latencyMs: 0, lossPct: 5, channels: [37, 38, 39], advertIntervalSeconds: [1, 10], availability: { noAdvertSeconds: 15 * 60 } },
    rf433: { latencyMs: 50, lossPct: 10, noAck: true, availability: { never: true } },
  };
}

/**
 * Interferencia Wi-Fi → Zigbee/Thread: canales 802.15.4 que solapa cada canal Wi-Fi y
 * penalización de pérdida (puntos porcentuales) por defecto.
 */
export const WIFI_802154_OVERLAP: Record<number, number[]> = { 1: [11, 12, 13, 14], 6: [16, 17, 18, 19], 11: [21, 22, 23, 24] };
export const WIFI_INTERFERENCE_LOSS_PCT = 3;

/** Vía por la que un dispositivo llega al HA real. */
export type DeviceTransport = 'z2m_mqtt' | 'mqtt_discovery' | 'zwave_js' | 'matter' | 'esphome' | 'shelly';

/** Transportes que en E1 se publican temporalmente por MQTT discovery genérico. */
export const PENDING_TRANSPORTS: Readonly<Partial<Record<DeviceTransport, 'E2' | 'E3'>>> = {
  zwave_js: 'E2',
  matter: 'E2',
  esphome: 'E3',
  shelly: 'E3',
};

/**
 * Transporte ideal hacia HA: Zigbee → Z2M emulado (ZHA y el puente Hue no tienen radio virtual:
 * MQTT genérico); Z-Wave → zwave_js; Matter/Thread → matter; ESPHome → esphome; Shelly → shelly;
 * el resto → MQTT discovery genérico.
 */
export function transportFor(device: Pick<Device, 'protocol' | 'integration'>, def: Pick<DeviceDefinition, 'integrations'>): DeviceTransport {
  const integration: string = device.integration;
  if (device.protocol === 'zwave' || integration === 'zwave_js') return 'zwave_js';
  if (device.protocol === 'matter' || device.protocol === 'thread' || integration === 'matter') return 'matter';
  if (integration === 'esphome' || (def.integrations as string[]).includes('esphome')) return 'esphome';
  if (integration === 'shelly') return 'shelly';
  if (device.protocol === 'zigbee' && integration !== 'zha' && integration !== 'hue') return 'z2m_mqtt';
  return 'mqtt_discovery';
}

/** Transporte que se usa de verdad en esta tanda (E1: los pendientes van por MQTT genérico). */
export function effectiveTransport(transport: DeviceTransport): 'z2m_mqtt' | 'mqtt_discovery' {
  return transport === 'z2m_mqtt' ? 'z2m_mqtt' : 'mqtt_discovery';
}

export interface Project {
  /** E1: ajustes del puente con el HA real (sin secretos). */
  haBridge?: HaBridgeSettings;
  /** E1: ajustes de los perfiles de radio por protocolo (sobre los valores por defecto). */
  radioProfiles?: Partial<Record<Protocol, Partial<RadioProfile>>>;
}

export interface SimulationState {
  /**
   * E1: las automatizaciones se ejecutan fuera (en el HA real). El motor no las dispara; las
   * ejecuciones manuales («Ejecutar») siguen funcionando.
   */
  automationsExternal?: boolean;
}
