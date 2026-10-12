// Proyecto de ejemplo: casa de dos plantas lista para simular.
import type { Automation, Device, Floor, Integration, Point, Project, Room, Scene, Script } from '../types';
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
}

// Rejilla de 200 × 100 px: los nodos (~180 × 70 px) no se solapan dentro de cada planta.
const SPECS: Spec[] = [
  { id: 'demo-servidor', def: 'ha-green', name: 'Home Assistant', floor: PB, room: 'demo-salon', at: { x: 20, y: 20 } },
  { id: 'demo-router', def: 'tplink-deco-x50', name: 'Router Wi-Fi', floor: PB, room: 'demo-salon', at: { x: 220, y: 20 } },
  { id: 'demo-coordinador', def: 'sonoff-zbdongle-p', name: 'Coordinador Zigbee', floor: PB, room: 'demo-salon', at: { x: 420, y: 20 } },
  { id: 'demo-puente-hue', def: 'hue-bridge-v2', name: 'Puente Hue', floor: PB, room: 'demo-salon', at: { x: 20, y: 120 } },
  { id: 'demo-luz-salon', def: 'hue-white-color-e27', name: 'Luz salón', floor: PB, room: 'demo-salon', at: { x: 220, y: 120 } },
  { id: 'demo-termostato', def: 'netatmo-thermostat', name: 'Termostato', floor: PB, room: 'demo-salon', at: { x: 420, y: 120 } },
  { id: 'demo-tv', def: 'samsung-qled-q80', name: 'Televisor', floor: PB, room: 'demo-salon', at: { x: 20, y: 220 } },
  { id: 'demo-altavoz', def: 'sonos-era-100', name: 'Altavoz salón', floor: PB, room: 'demo-salon', at: { x: 220, y: 220 } },
  { id: 'demo-nest-hub', def: 'google-nest-hub-2', name: 'Nest Hub cocina', floor: PB, room: 'demo-cocina', at: { x: 640, y: 20 } },
  { id: 'demo-luz-cocina', def: 'shelly-1pm-gen3', name: 'Luz cocina', floor: PB, room: 'demo-cocina', at: { x: 840, y: 20 } },
  { id: 'demo-cafetera', def: 'sonoff-s26r2', name: 'Cafetera', floor: PB, room: 'demo-cocina', at: { x: 640, y: 120 } },
  { id: 'demo-puerta', def: 'aqara-door-window', name: 'Puerta entrada', floor: PB, room: 'demo-entrada', at: { x: 20, y: 420 }, integration: 'zha' },
  { id: 'demo-cerradura', def: 'aqara-u200', name: 'Cerradura entrada', floor: PB, room: 'demo-entrada', at: { x: 220, y: 420 } },
  { id: 'demo-camara', def: 'reolink-rlc-810a', name: 'Cámara entrada', floor: PB, room: 'demo-entrada', at: { x: 20, y: 520 } },
  { id: 'demo-movimiento', def: 'aqara-motion-p1', name: 'Movimiento pasillo', floor: PB, room: 'demo-pasillo', at: { x: 440, y: 420 }, integration: 'zha' },
  { id: 'demo-luz-pasillo', def: 'ikea-tradfri-e27-ws', name: 'Luz pasillo', floor: PB, room: 'demo-pasillo', at: { x: 640, y: 420 }, integration: 'zha' },
  { id: 'demo-clima-dormitorio', def: 'aqara-temp-hum', name: 'Clima dormitorio', floor: P1, room: 'demo-dormitorio', at: { x: 20, y: 20 }, integration: 'zha' },
  { id: 'demo-luz-dormitorio', def: 'hue-white-e27', name: 'Luz dormitorio', floor: P1, room: 'demo-dormitorio', at: { x: 220, y: 120 } },
  { id: 'demo-enchufe-dormitorio', def: 'sonoff-s26r2zb', name: 'Ventilador dormitorio', floor: P1, room: 'demo-dormitorio', at: { x: 420, y: 120 } },
  { id: 'demo-persiana', def: 'shelly-2pm-gen3-cover', name: 'Persiana dormitorio', floor: P1, room: 'demo-dormitorio', at: { x: 20, y: 220 } },
  { id: 'demo-enchufe-bano', def: 'shelly-plug-s-gen3', name: 'Enchufe baño', floor: P1, room: 'demo-bano', at: { x: 640, y: 20 } },
  { id: 'demo-sensor-bano', def: 'xiaomi-lywsd03mmc', name: 'Sensor baño', floor: P1, room: 'demo-bano', at: { x: 840, y: 20 } },
  { id: 'demo-aspiradora', def: 'xiaomi-robot-vacuum-s10', name: 'Aspiradora', floor: P1, room: 'demo-despacho', at: { x: 640, y: 320 } },
];

function buildDevice(spec: Spec): Device {
  const def = getDefinition(spec.def, catalog);
  const protocol = def?.protocols[0];
  const integration = spec.integration ?? def?.integrations[0];
  if (!protocol || !integration) throw new Error(`Proyecto de ejemplo: definición desconocida "${spec.def}"`);
  return { id: spec.id, definitionId: spec.def, name: spec.name, floorId: spec.floor, roomId: spec.room, position: { ...spec.at }, protocol, integration };
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
];

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

/** Casa de ejemplo con 2 plantas, salas, dispositivos conectados, automatizaciones, escenas y un script. */
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
  };
  return { ...base, connections: suggestConnections(base, catalog) };
}
