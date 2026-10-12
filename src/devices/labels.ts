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
};

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
};

/** hvac_action de un termostato. */
export const HVAC_ACTION_LABELS: Record<string, string> = {
  heating: 'Calentando',
  cooling: 'Enfriando',
  drying: 'Deshumidificando',
  fan: 'Ventilando',
  idle: 'En reposo',
  off: 'Apagado',
};

/** Modos HVAC (estado de una entidad climate). */
export const HVAC_MODE_LABELS: Record<string, string> = {
  off: 'Apagado',
  heat: 'Calefacción',
  cool: 'Refrigeración',
  heat_cool: 'Calor/frío',
  auto: 'Automático',
  dry: 'Deshumidificar',
  fan_only: 'Solo ventilador',
};

/** Presets habituales de termostatos. */
export const PRESET_LABELS: Record<string, string> = {
  eco: 'Eco',
  away: 'Ausente',
  home: 'En casa',
  comfort: 'Confort',
  boost: 'Turbo',
  sleep: 'Noche',
  manual: 'Manual',
  auto: 'Automático',
  schedule: 'Programación',
  frost_guard: 'Antiheladas',
  activity: 'Actividad',
  none: 'Ninguno',
};

/** Etiqueta de un valor con su tabla, o el propio valor si no está. */
export function labelOf(table: Record<string, string>, value: string): string {
  return table[value] ?? value;
}
