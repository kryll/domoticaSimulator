// Etiquetas en español y listas de valores válidos del dominio.
// Los Record<Unión, ...> garantizan en compilación que no falta ningún valor.
import type {
  Brand,
  DeviceCategory,
  EntityDomain,
  Integration,
  IotClass,
  NetworkRole,
  PowerSource,
  Protocol,
} from '../types';

export const PROTOCOL_LABELS: Record<Protocol, string> = {
  wifi: 'Wi-Fi',
  ethernet: 'Ethernet',
  zigbee: 'Zigbee',
  zwave: 'Z-Wave',
  thread: 'Thread',
  matter: 'Matter',
  ble: 'Bluetooth LE',
  rf433: 'RF 433 MHz',
};

export const INTEGRATION_LABELS: Record<Integration, string> = {
  zha: 'ZHA',
  zigbee2mqtt: 'Zigbee2MQTT',
  matter: 'Matter',
  homekit_device: 'HomeKit Device',
  xiaomi_miio: 'Xiaomi Miio',
  tuya: 'Tuya',
  ewelink: 'eWeLink',
  shelly: 'Shelly',
  hue: 'Philips Hue',
  google_cast: 'Google Cast',
  alexa_media_player: 'Alexa Media Player',
  zwave_js: 'Z-Wave JS',
  xiaomi_ble: 'Xiaomi BLE',
  netatmo: 'Netatmo',
  reolink: 'Reolink',
  sonos: 'Sonos',
  samsungtv: 'Samsung Smart TV',
  webostv: 'LG webOS TV',
  tplink: 'TP-Link Smart Home',
  homeassistant: 'Home Assistant',
  esphome: 'ESPHome',
  daikin_onecta: 'Daikin Onecta',
  sensibo: 'Sensibo',
  meross_lan: 'Meross LAN',
  roborock: 'Roborock',
  ecovacs: 'Ecovacs',
  dreame_vacuum: 'Dreame Vacuum (HACS)',
  roomba: 'iRobot Roomba y Braava',
  eufy_robovac: 'Eufy RoboVac (HACS)',
  wyoming: 'Wyoming Protocol',
  apple_tv: 'Apple TV (AirPlay)',
};

/** Integraciones que no son oficiales: se instalan con HACS (repositorios de la comunidad). */
export const HACS_INTEGRATIONS: ReadonlySet<Integration> = new Set<Integration>(['alexa_media_player', 'dreame_vacuum', 'eufy_robovac']);

export const CATEGORY_LABELS: Record<DeviceCategory, string> = {
  light: 'Iluminación',
  plug: 'Enchufes',
  switch: 'Interruptores y relés',
  sensor: 'Sensores',
  climate: 'Climatización',
  cover: 'Persianas y cortinas',
  lock: 'Cerraduras',
  camera: 'Cámaras',
  speaker: 'Altavoces',
  display: 'Pantallas y TV',
  vacuum: 'Robots aspiradores',
  hub: 'Hubs y coordinadores',
  network: 'Red',
  server: 'Servidores',
};

export const ROLE_LABELS: Record<NetworkRole, string> = {
  end_device: 'Dispositivo final',
  router: 'Router de malla',
  coordinator: 'Coordinador',
  hub: 'Hub / puente',
  border_router: 'Border router Thread',
  access_point: 'Punto de acceso',
  ha_server: 'Servidor Home Assistant',
};

export const IOT_CLASS_LABELS: Record<IotClass, string> = {
  local_push: 'Local (push)',
  local_polling: 'Local (sondeo)',
  cloud_push: 'Nube (push)',
  cloud_polling: 'Nube (sondeo)',
};

export const POWER_LABELS: Record<PowerSource, string> = {
  mains: 'Red eléctrica',
  battery: 'Pilas',
  usb: 'USB',
  poe: 'PoE',
};

const BRAND_SET: Record<Brand, true> = {
  IKEA: true,
  SONOFF: true,
  Aqara: true,
  Xiaomi: true,
  Shelly: true,
  'Philips Hue': true,
  Amazon: true,
  Google: true,
  Tuya: true,
  'TP-Link': true,
  Netatmo: true,
  Reolink: true,
  Sonos: true,
  Samsung: true,
  LG: true,
  'Home Assistant': true,
  Eve: true,
  Nanoleaf: true,
  Heiman: true,
  Daikin: true,
  Sensibo: true,
  Meross: true,
  Roborock: true,
  Ecovacs: true,
  Aeotec: true,
  Fibaro: true,
  Zooz: true,
  ESPHome: true,
  Dreame: true,
  iRobot: true,
  Eufy: true,
  Apple: true,
  Espressif: true,
  'Raspberry Pi': true,
};

const DOMAIN_SET: Record<EntityDomain, true> = {
  light: true,
  switch: true,
  sensor: true,
  binary_sensor: true,
  climate: true,
  cover: true,
  lock: true,
  camera: true,
  media_player: true,
  fan: true,
  vacuum: true,
  button: true,
  alarm_control_panel: true,
  valve: true,
  siren: true,
  select: true,
  assist_satellite: true,
};

function keysOf<K extends string>(record: Record<K, unknown>): K[] {
  return Object.keys(record) as K[];
}

export const PROTOCOLS: Protocol[] = keysOf(PROTOCOL_LABELS);
export const INTEGRATIONS: Integration[] = keysOf(INTEGRATION_LABELS);
export const CATEGORIES: DeviceCategory[] = keysOf(CATEGORY_LABELS);
export const ROLES: NetworkRole[] = keysOf(ROLE_LABELS);
export const IOT_CLASSES: IotClass[] = keysOf(IOT_CLASS_LABELS);
export const POWER_SOURCES: PowerSource[] = keysOf(POWER_LABELS);
export const BRANDS: Brand[] = keysOf(BRAND_SET);
export const ENTITY_DOMAINS: EntityDomain[] = keysOf(DOMAIN_SET);

/** Clase IoT típica de cada integración (para cuando el usuario cambia de integración). */
export const INTEGRATION_IOT_CLASS: Record<Integration, IotClass> = {
  zha: 'local_polling',
  zigbee2mqtt: 'local_push',
  matter: 'local_push',
  homekit_device: 'local_push',
  xiaomi_miio: 'local_polling',
  tuya: 'cloud_push',
  ewelink: 'cloud_push',
  shelly: 'local_push',
  hue: 'local_push',
  google_cast: 'local_push',
  alexa_media_player: 'cloud_polling',
  zwave_js: 'local_push',
  xiaomi_ble: 'local_push',
  netatmo: 'cloud_polling',
  reolink: 'local_push',
  sonos: 'local_push',
  samsungtv: 'local_push',
  webostv: 'local_push',
  tplink: 'local_polling',
  homeassistant: 'local_push',
  esphome: 'local_push',
  daikin_onecta: 'cloud_polling',
  sensibo: 'cloud_polling',
  meross_lan: 'local_polling',
  roborock: 'local_polling',
  ecovacs: 'cloud_push',
  dreame_vacuum: 'cloud_polling',
  roomba: 'local_push',
  eufy_robovac: 'local_polling',
  wyoming: 'local_push',
  apple_tv: 'local_push',
};

/** hvac_action de un termostato (acción HVAC en curso, como HA en español). */
export const HVAC_ACTION_LABELS: Record<string, string> = {
  heating: 'Calentando',
  cooling: 'Enfriando',
  drying: 'Secando',
  fan: 'Ventilando',
  idle: 'Inactivo',
  off: 'Apagado',
  preheating: 'Precalentando',
  defrosting: 'Descongelando',
};

/** Modos HVAC (estado de una entidad climate). */
export const HVAC_MODE_LABELS: Record<string, string> = {
  heat: 'Calefacción',
  cool: 'Refrigeración',
  heat_cool: 'Calor/frío',
  auto: 'Auto',
  dry: 'Deshumidificar',
  fan_only: 'Solo ventilador',
  off: 'Apagado',
};

/** Presets de termostatos (preset_mode), incluidos los de Netatmo, Tuya y Aqara. */
export const PRESET_LABELS: Record<string, string> = {
  none: 'Ninguno',
  eco: 'Eco',
  away: 'Ausente',
  home: 'En casa',
  comfort: 'Confort',
  boost: 'Turbo',
  sleep: 'Noche',
  activity: 'Actividad',
  manual: 'Manual',
  auto: 'Auto',
  schedule: 'Programación',
  frost_guard: 'Antihielo',
  frost_protection: 'Antihielo',
  holiday: 'Vacaciones',
};

/** Acciones de los mandos (estado del sensor `*_action`). */
export const BUTTON_ACTION_LABELS: Record<string, string> = {
  single: 'Pulsación',
  double: 'Doble',
  triple: 'Triple',
  hold: 'Mantener',
  long: 'Larga',
  release: 'Soltar',
  shake: 'Agitar',
  on: 'Encender',
  off: 'Apagar',
  brightness_up: 'Subir brillo',
  brightness_down: 'Bajar brillo',
  arrow_left: 'Izquierda',
  arrow_right: 'Derecha',
  toggle: 'Alternar',
  none: 'En espera',
};

/** Tanda 3: estados de una alarma (alarm_control_panel). */
export const ALARM_STATE_LABELS: Record<string, string> = {
  disarmed: 'Desarmada',
  armed_home: 'Armada en casa',
  armed_away: 'Armada fuera',
  armed_night: 'Armada noche',
  armed_vacation: 'Armada vacaciones',
  armed_custom_bypass: 'Armada personalizada',
  arming: 'Armando',
  pending: 'Pendiente',
  triggered: 'Disparada',
};

/** Tanda 3: estados de una válvula (valve). */
export const VALVE_STATE_LABELS: Record<string, string> = {
  open: 'Abierta',
  closed: 'Cerrada',
  opening: 'Abriendo',
  closing: 'Cerrando',
};

/** Etiqueta de un valor con su tabla, o el propio valor si no está. */
export function labelOf(table: Record<string, string>, value: string): string {
  return table[value] ?? value;
}

/** Potencias de aspiración de los robots (Roborock, Dreame, Ecovacs, Eufy...). */
export const FAN_SPEED_LABELS: Record<string, string> = {
  off: 'Apagado (solo fregar)',
  quiet: 'Silencioso',
  silent: 'Silencioso',
  balanced: 'Equilibrado',
  standard: 'Estándar',
  normal: 'Normal',
  medium: 'Media',
  strong: 'Fuerte',
  turbo: 'Turbo',
  max: 'Máxima',
  max_plus: 'Máxima+',
};

/** Opciones de los select de los robots (modo de limpieza y agua). */
export const SELECT_OPTION_LABELS: Record<string, string> = {
  vacuum: 'Solo aspirar',
  vacuum_mop: 'Aspirar y fregar',
  mop: 'Solo fregar',
  low: 'Poca agua',
  medium: 'Agua media',
  high: 'Mucha agua',
};

/** Estado de la base de un robot (sensor dock_status). */
export const DOCK_STATUS_LABELS: Record<string, string> = {
  idle: 'En reposo',
  emptying: 'Vaciando el depósito',
  washing_mop: 'Lavando la mopa',
  drying: 'Secando la mopa',
};

/** Estados de un satélite de voz (assist_satellite). */
export const ASSIST_SATELLITE_LABELS: Record<string, string> = {
  idle: 'En reposo',
  listening: 'Escuchando',
  processing: 'Procesando',
  responding: 'Respondiendo',
};
