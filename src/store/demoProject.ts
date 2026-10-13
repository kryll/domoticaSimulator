// Proyecto de ejemplo: casa de dos plantas lista para simular.
import { defaultSettings, type Automation, type Device, type Floor, type Integration, type Point, type Project, type Room, type Scene, type Script } from '../types';
import { catalog, getDefinition } from '../devices/catalog';
import { suggestConnections } from '../network/connections';

const PB = 'demo-planta-baja';
const P1 = 'demo-primera-planta';

function rect(id: string, floorId: string, name: string, x1: number, y1: number, x2: number, y2: number): Room {
  return { id, floorId, name, polygon: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }] };
}

const FLOORS: Floor[] = [
  { id: PB, name: 'Planta baja', level: 0, pixelsPerMeter: 50 },
  { id: P1, name: 'Primera planta', level: 1, pixelsPerMeter: 50 },
];

const ROOMS: Room[] = [
  rect('demo-salon', PB, 'Salón', 0, 0, 620, 400),
  rect('demo-cocina', PB, 'Cocina', 620, 0, 1040, 400),
  rect('demo-entrada', PB, 'Entrada', 0, 400, 420, 620),
  rect('demo-pasillo', PB, 'Pasillo', 420, 400, 1040, 620),
  rect('demo-dormitorio', P1, 'Dormitorio', 0, 0, 620, 400),
  rect('demo-distribuidor', P1, 'Distribuidor', 0, 400, 620, 620),
  rect('demo-bano', P1, 'Baño', 620, 0, 1040, 300),
  rect('demo-despacho', P1, 'Despacho', 620, 300, 1040, 620),
];

interface Spec {
  id: string;
  def: string;
  name: string;
  floor: string;
  room: string;
  at: Point;
  integration?: Integration;
  /** Carga conectada (enchufes y relés), en vatios. */
  loadWatts?: number;
  /** Conectado a un SAI. */
  ups?: boolean;
  /** Asistentes a los que se expone (por defecto, solo Assist). */
  exposedTo?: Device['exposedTo'];
  /** Robot: salas de su mapa. */
  vacuumRooms?: string[];
}

// Rejilla de 200 × 100 px: los nodos (~180 × 70 px) no se solapan dentro de cada planta.
const SPECS: Spec[] = [
  { id: 'demo-servidor', def: 'ha-green', name: 'Home Assistant', floor: PB, room: 'demo-salon', at: { x: 20, y: 20 }, ups: true },
  { id: 'demo-router', def: 'tplink-deco-x50', name: 'Router Wi-Fi', floor: PB, room: 'demo-salon', at: { x: 220, y: 20 } },
  { id: 'demo-coordinador', def: 'sonoff-zbdongle-p', name: 'Coordinador Zigbee', floor: PB, room: 'demo-salon', at: { x: 420, y: 20 } },
  { id: 'demo-puente-hue', def: 'hue-bridge-v2', name: 'Puente Hue', floor: PB, room: 'demo-salon', at: { x: 20, y: 120 } },
  { id: 'demo-luz-salon', def: 'hue-white-color-e27', name: 'Luz salón', floor: PB, room: 'demo-salon', at: { x: 220, y: 120 }, exposedTo: ['assist', 'google'] },
  { id: 'demo-termostato', def: 'netatmo-thermostat', name: 'Termostato', floor: PB, room: 'demo-salon', at: { x: 420, y: 120 }, exposedTo: ['assist', 'alexa', 'google'] },
  { id: 'demo-tv', def: 'samsung-qled-q80', name: 'Televisor', floor: PB, room: 'demo-salon', at: { x: 20, y: 220 } },
  { id: 'demo-altavoz', def: 'sonos-era-100', name: 'Altavoz salón', floor: PB, room: 'demo-salon', at: { x: 220, y: 220 } },
  { id: 'demo-mando', def: 'aqara-wireless-mini-switch', name: 'Mando salón', floor: PB, room: 'demo-salon', at: { x: 420, y: 220 }, integration: 'zha' },
  // Robot aspirador con base de autovaciado: limpia el salón y la cocina (segmentos 16 y 17).
  { id: 'demo-robot', def: 'roborock-qrevo-curv', name: 'Robot aspirador', floor: PB, room: 'demo-salon', at: { x: 20, y: 320 }, vacuumRooms: ['demo-salon', 'demo-cocina'] },
  { id: 'demo-nest-audio', def: 'google-nest-audio', name: 'Nest salón', floor: PB, room: 'demo-salon', at: { x: 220, y: 320 } },
  { id: 'demo-nest-hub', def: 'google-nest-hub-2', name: 'Nest Hub cocina', floor: PB, room: 'demo-cocina', at: { x: 640, y: 20 } },
  { id: 'demo-luz-cocina', def: 'shelly-1pm-gen3', name: 'Luz cocina', floor: PB, room: 'demo-cocina', at: { x: 840, y: 20 }, loadWatts: 36 },
  { id: 'demo-cafetera', def: 'sonoff-s26r2', name: 'Cafetera', floor: PB, room: 'demo-cocina', at: { x: 640, y: 120 }, loadWatts: 1200 },
  { id: 'demo-voz-cocina', def: 'ha-voice-pe', name: 'Voz cocina', floor: PB, room: 'demo-cocina', at: { x: 840, y: 120 } },
  { id: 'demo-puerta', def: 'aqara-door-window', name: 'Puerta entrada', floor: PB, room: 'demo-entrada', at: { x: 20, y: 420 }, integration: 'zha' },
  { id: 'demo-cerradura', def: 'aqara-u200', name: 'Cerradura entrada', floor: PB, room: 'demo-entrada', at: { x: 220, y: 420 } },
  { id: 'demo-camara', def: 'reolink-rlc-810a', name: 'Cámara entrada', floor: PB, room: 'demo-entrada', at: { x: 20, y: 520 } },
  { id: 'demo-movimiento', def: 'aqara-motion-p1', name: 'Movimiento pasillo', floor: PB, room: 'demo-pasillo', at: { x: 440, y: 420 }, integration: 'zha' },
  { id: 'demo-luz-pasillo', def: 'ikea-tradfri-e27-ws', name: 'Luz pasillo', floor: PB, room: 'demo-pasillo', at: { x: 640, y: 420 }, integration: 'zha' },
  { id: 'demo-clima-dormitorio', def: 'aqara-temp-hum', name: 'Clima dormitorio', floor: P1, room: 'demo-dormitorio', at: { x: 20, y: 20 }, integration: 'zha' },
  { id: 'demo-luz-dormitorio', def: 'hue-white-e27', name: 'Luz dormitorio', floor: P1, room: 'demo-dormitorio', at: { x: 220, y: 120 }, exposedTo: ['assist', 'alexa'] },
  { id: 'demo-echo', def: 'amazon-echo-dot-5', name: 'Echo dormitorio', floor: P1, room: 'demo-dormitorio', at: { x: 420, y: 20 } },
  { id: 'demo-enchufe-dormitorio', def: 'sonoff-s26r2zb', name: 'Ventilador dormitorio', floor: P1, room: 'demo-dormitorio', at: { x: 420, y: 120 }, loadWatts: 45 },
  { id: 'demo-persiana', def: 'shelly-2pm-gen3-cover', name: 'Persiana dormitorio', floor: P1, room: 'demo-dormitorio', at: { x: 20, y: 220 }, exposedTo: ['assist', 'alexa'] },
  { id: 'demo-enchufe-bano', def: 'shelly-plug-s-gen3', name: 'Enchufe baño', floor: P1, room: 'demo-bano', at: { x: 640, y: 20 }, loadWatts: 1500 },
  { id: 'demo-sensor-bano', def: 'xiaomi-lywsd03mmc', name: 'Sensor baño', floor: P1, room: 'demo-bano', at: { x: 840, y: 20 } },
  { id: 'demo-fuga-bano', def: 'aqara-water-leak', name: 'Fuga baño', floor: P1, room: 'demo-bano', at: { x: 640, y: 120 }, integration: 'zha' },
  { id: 'demo-aspiradora', def: 'xiaomi-robot-vacuum-s10', name: 'Aspiradora', floor: P1, room: 'demo-despacho', at: { x: 640, y: 320 } },
];

function buildDevice(spec: Spec): Device {
  const def = getDefinition(spec.def, catalog);
  const protocol = def?.protocols[0];
  const integration = spec.integration ?? def?.integrations[0];
  if (!protocol || !integration) throw new Error(`Proyecto de ejemplo: definición desconocida "${spec.def}"`);
  const device: Device = { id: spec.id, definitionId: spec.def, name: spec.name, floorId: spec.floor, roomId: spec.room, position: { ...spec.at }, protocol, integration };
  if (spec.loadWatts !== undefined) device.loadWatts = spec.loadWatts;
  if (spec.ups) device.ups = true;
  if (spec.exposedTo) device.exposedTo = [...spec.exposedTo];
  if (spec.vacuumRooms) device.vacuumRooms = [...spec.vacuumRooms];
  return device;
}

const AUTOMATIONS: Automation[] = [
  {
    id: 'demo-auto-movimiento',
    name: 'Luz del salón al detectar movimiento de noche',
    enabled: true,
    mode: 'restart',
    triggers: [{ type: 'state', entityId: 'binary_sensor.movimiento_pasillo_motion', to: 'on' }],
    conditions: [{ type: 'time', after: '20:00', before: '07:30' }],
    actions: [
      { type: 'service', service: 'light.turn_on', entityId: 'light.luz_salon', data: { brightness: 120 } },
      { type: 'delay', seconds: 120 },
      { type: 'service', service: 'light.turn_off', entityId: 'light.luz_salon' },
    ],
  },
  {
    id: 'demo-auto-pasillo-on',
    name: 'Encender la luz del pasillo con movimiento',
    enabled: true,
    mode: 'single',
    triggers: [{ type: 'state', entityId: 'binary_sensor.movimiento_pasillo_motion', to: 'on' }],
    conditions: [],
    actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_pasillo', data: { brightness_pct: 80, color_temp_kelvin: 3000 } }],
  },
  {
    id: 'demo-auto-pasillo-off',
    name: 'Apagar la luz del pasillo tras 2 min sin movimiento',
    enabled: true,
    mode: 'single',
    triggers: [{ type: 'state', entityId: 'binary_sensor.movimiento_pasillo_motion', to: 'off', for: 120 }],
    conditions: [],
    actions: [{ type: 'service', service: 'light.turn_off', entityId: 'light.luz_pasillo' }],
  },
  {
    id: 'demo-auto-mando',
    name: 'Mando del salón: una pulsación enciende o apaga la luz',
    enabled: true,
    mode: 'single',
    triggers: [{ type: 'state', entityId: 'sensor.mando_salon_action', to: 'single' }],
    conditions: [],
    actions: [{ type: 'service', service: 'light.toggle', entityId: 'light.luz_salon' }],
  },
  {
    id: 'demo-auto-mando-doble',
    name: 'Mando del salón: doble pulsación activa la escena Cine',
    enabled: true,
    mode: 'single',
    triggers: [{ type: 'state', entityId: 'sensor.mando_salon_action', to: 'double' }],
    conditions: [],
    actions: [{ type: 'scene', sceneId: 'demo-escena-cine' }],
  },
  {
    id: 'demo-auto-fuga',
    name: 'Fuga de agua en el baño: cortar el enchufe',
    enabled: true,
    mode: 'single',
    triggers: [{ type: 'state', entityId: 'binary_sensor.fuga_bano_leak', to: 'on' }],
    conditions: [],
    actions: [
      { type: 'service', service: 'switch.turn_off', entityId: 'switch.enchufe_bano_switch' },
      // Notificación persistente de HA: llega también a la bandeja de notificaciones.
      { type: 'service', service: 'notify.persistent_notification', entityId: '', data: { title: 'Fuga de agua', message: 'Se ha cortado el enchufe del baño' } },
    ],
  },
  {
    id: 'demo-auto-atardecer',
    name: 'Bajar la persiana al atardecer',
    enabled: true,
    mode: 'single',
    triggers: [{ type: 'sun', event: 'sunset', offsetMinutes: -15 }],
    conditions: [],
    actions: [
      { type: 'service', service: 'cover.close_cover', entityId: 'cover.persiana_dormitorio_cover' },
      { type: 'service', service: 'light.turn_on', entityId: 'light.luz_dormitorio', data: { brightness: 80 } },
    ],
  },
  {
    id: 'demo-auto-calor',
    name: 'Ventilador si hace calor en el dormitorio',
    enabled: true,
    mode: 'single',
    triggers: [{ type: 'numeric_state', entityId: 'sensor.clima_dormitorio_temperature', above: 26 }],
    conditions: [],
    actions: [{ type: 'service', service: 'switch.turn_on', entityId: 'switch.ventilador_dormitorio' }],
  },
  {
    id: 'demo-auto-salir',
    name: 'Al salir Ana: apagar luces si no queda nadie',
    enabled: true,
    mode: 'single',
    triggers: [{ type: 'zone', personId: 'demo-ana', zoneId: 'home', event: 'leave' }],
    conditions: [],
    actions: [
      {
        type: 'choose',
        choices: [
          {
            conditions: [{ type: 'numeric_state', entityId: 'zone.home', below: 1 }],
            sequence: [
              { type: 'service', service: 'light.turn_off', entityId: 'light.grupo_planta_baja' },
              { type: 'notify', title: 'Casa vacía', message: 'Se han apagado las luces de la planta baja' },
            ],
          },
        ],
        default: [{ type: 'notify', title: 'Ana ha salido', message: 'Todavía queda alguien en casa' }],
      },
    ],
  },
  // Tanda 3: helpers (input_boolean «Modo vacaciones» y timer «Cafetera»).
  {
    id: 'demo-auto-cafetera-timer',
    name: 'Cafetera: apagar sola a los 20 minutos',
    enabled: true,
    mode: 'restart',
    triggers: [
      { type: 'state', entityId: 'switch.cafetera', to: 'on', id: 'encendida' },
      { type: 'event', eventType: 'timer.finished', eventData: { entity_id: 'timer.cafetera' }, id: 'fin' },
    ],
    conditions: [],
    actions: [
      {
        type: 'choose',
        choices: [
          { conditions: [{ type: 'trigger', ids: ['encendida'] }], sequence: [{ type: 'service', service: 'timer.start', entityId: 'timer.cafetera' }] },
          { conditions: [{ type: 'trigger', ids: ['fin'] }], sequence: [{ type: 'service', service: 'switch.turn_off', entityId: 'switch.cafetera' }] },
        ],
      },
    ],
  },
  {
    id: 'demo-auto-vacaciones',
    name: 'Modo vacaciones: simular presencia al anochecer',
    enabled: true,
    mode: 'single',
    triggers: [{ type: 'sun', event: 'sunset', offsetMinutes: 30 }],
    conditions: [{ type: 'state', entityId: 'input_boolean.modo_vacaciones', state: 'on' }],
    actions: [
      { type: 'service', service: 'light.turn_on', entityId: 'light.luz_salon', data: { brightness_pct: 70 } },
      { type: 'delay', seconds: 7200 },
      { type: 'service', service: 'light.turn_off', entityId: 'light.luz_salon' },
    ],
  },
];

AUTOMATIONS.push(
  {
    id: 'demo-auto-robot-salir',
    name: 'Cuando todos salen de casa, el robot limpia',
    description: 'Limpia el salón y la cocina (segmentos 16 y 17 del mapa del Roborock) cuando no queda nadie en casa.',
    enabled: true,
    mode: 'single',
    triggers: [
      { type: 'zone', personId: 'demo-ana', zoneId: 'home', event: 'leave' },
      { type: 'zone', personId: 'demo-luis', zoneId: 'home', event: 'leave' },
    ],
    conditions: [{ type: 'numeric_state', entityId: 'zone.home', below: 1 }],
    actions: [{ type: 'service', service: 'vacuum.send_command', entityId: 'vacuum.robot_aspirador_vacuum', data: { command: 'app_segment_clean', params: '[16, 17]' } }],
  },
  {
    id: 'demo-auto-robot-error',
    name: 'Si el robot da error, avisa por el asistente de la cocina',
    enabled: true,
    mode: 'single',
    triggers: [{ type: 'state', entityId: 'vacuum.robot_aspirador_vacuum', to: 'error' }],
    conditions: [],
    actions: [{ type: 'service', service: 'assist_satellite.announce', entityId: 'assist_satellite.voz_cocina_satellite', data: { message: 'El robot aspirador tiene un problema y necesita ayuda' } }],
  },
  {
    id: 'demo-auto-fuga-anuncio',
    name: 'Al saltar la fuga de agua, anuncio en todos los altavoces',
    enabled: true,
    mode: 'single',
    triggers: [{ type: 'state', entityId: 'binary_sensor.fuga_bano_leak', to: 'on' }],
    conditions: [],
    actions: [
      // Alexa Media Player va por la nube: si no hay Internet, sigue con el resto (continue_on_error).
      { type: 'notify', service: 'notify.alexa_media_echo_dormitorio', message: 'Atención: hay una fuga de agua en el baño', continueOnError: true },
      { type: 'service', service: 'tts.speak', entityId: 'tts.piper', data: { media_player_entity_id: 'media_player.nest_salon, media_player.altavoz_salon', message: 'Atención: hay una fuga de agua en el baño' }, continueOnError: true },
      { type: 'service', service: 'assist_satellite.announce', entityId: 'assist_satellite.voz_cocina_satellite', data: { message: 'Atención: hay una fuga de agua en el baño' } },
    ],
  },
);

const SCENES: Scene[] = [
  {
    id: 'demo-escena-cine',
    name: 'Cine',
    entities: {
      'light.luz_salon': { state: 'on', attributes: { brightness: 40, color_mode: 'rgb', rgb_color: '[255, 120, 40]' } },
      'media_player.televisor': { state: 'on' },
      'media_player.altavoz_salon': { state: 'playing' },
    },
  },
  {
    id: 'demo-escena-noche',
    name: 'Buenas noches',
    entities: {
      'light.luz_salon': { state: 'off' },
      'light.luz_dormitorio': { state: 'off' },
      'light.luz_pasillo': { state: 'off' },
      'switch.luz_cocina_switch': { state: 'off' },
      'media_player.televisor': { state: 'off' },
      'lock.cerradura_entrada_lock': { state: 'locked' },
    },
  },
];

const SCRIPTS: Script[] = [
  {
    id: 'demo-script-salir',
    name: 'Salir de casa',
    sequence: [
      { type: 'scene', sceneId: 'demo-escena-noche' },
      { type: 'service', service: 'vacuum.start', entityId: 'vacuum.aspiradora_vacuum' },
      { type: 'delay', seconds: 5 },
      { type: 'service', service: 'climate.set_temperature', entityId: 'climate.termostato_climate', data: { temperature: 17 } },
    ],
  },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Casa de ejemplo con 2 plantas, salas, dispositivos conectados, automatizaciones, escenas y un
 * script; ajustes (ubicación y precios), personas, zonas y un grupo de luces.
 */
export function createDemoProject(): Project {
  const now = new Date().toISOString();
  const base: Project = {
    id: crypto.randomUUID(),
    name: 'Casa de ejemplo',
    version: 1,
    createdAt: now,
    updatedAt: now,
    floors: FLOORS.map((f) => ({ ...f })),
    rooms: ROOMS.map((r) => ({ ...r, polygon: r.polygon.map((p) => ({ ...p })) })),
    devices: SPECS.map(buildDevice),
    connections: [],
    automations: clone(AUTOMATIONS),
    scenes: clone(SCENES),
    scripts: clone(SCRIPTS),
    settings: defaultSettings(),
    people: [
      { id: 'demo-ana', name: 'Ana', color: '#e11d48' },
      { id: 'demo-luis', name: 'Luis', color: '#2563eb' },
    ],
    zones: [{ id: 'demo-trabajo', name: 'Trabajo', kind: 'work', latitude: 40.453, longitude: -3.6883, radius: 200 }],
    groups: [{ id: 'demo-grupo-pb', name: 'Planta baja', domain: 'light', entityIds: ['light.luz_salon', 'light.luz_pasillo'] }],
    helpers: [
      { id: 'demo-helper-vacaciones', type: 'input_boolean', name: 'Modo vacaciones', icon: 'mdi:palm-tree' },
      { id: 'demo-helper-cafetera', type: 'timer', name: 'Cafetera', duration: 1200, icon: 'mdi:coffee-maker' },
    ],
  };
  return { ...base, connections: suggestConnections(base, catalog) };
}
