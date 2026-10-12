// Plantillas de casa (B18): plantas, salas y una instalación base coherente que pasa el validador.
import type { Automation, Device, Floor, Integration, Point, Project, Room, Scene } from '../types';
import { catalog, getDefinition } from '../devices/catalog';
import { suggestConnections } from '../network/connections';

export interface HouseTemplate {
  id: string;
  name: string;
  description: string;
}

interface DeviceSpec {
  def: string;
  name: string;
  room: string;
  /** Posición relativa a la esquina superior izquierda de la sala. */
  at: Point;
  integration?: Integration;
}

interface RoomSpec {
  key: string;
  name: string;
  floor: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface TemplateSpec extends HouseTemplate {
  floors: string[];
  rooms: RoomSpec[];
  devices: DeviceSpec[];
  automations: Automation[];
  scenes: Scene[];
}

const auto = (id: string, name: string, partial: Pick<Automation, 'triggers' | 'actions'> & Partial<Automation>): Automation => ({
  id,
  name,
  enabled: true,
  mode: 'single',
  conditions: [],
  ...partial,
});

const PISO: TemplateSpec = {
  id: 'piso-2-dormitorios',
  name: 'Piso de 2 dormitorios',
  description: 'Una planta con salón, cocina, dos dormitorios, baño y pasillo. Zigbee con ZHA, Wi-Fi y servidor Home Assistant Green.',
  floors: ['Vivienda'],
  rooms: [
    { key: 'salon', name: 'Salón', floor: 0, x1: 0, y1: 0, x2: 500, y2: 350 },
    { key: 'cocina', name: 'Cocina', floor: 0, x1: 500, y1: 0, x2: 800, y2: 350 },
    { key: 'pasillo', name: 'Pasillo', floor: 0, x1: 0, y1: 350, x2: 800, y2: 450 },
    { key: 'dormitorio', name: 'Dormitorio principal', floor: 0, x1: 0, y1: 450, x2: 350, y2: 750 },
    { key: 'dormitorio2', name: 'Dormitorio 2', floor: 0, x1: 350, y1: 450, x2: 600, y2: 750 },
    { key: 'bano', name: 'Baño', floor: 0, x1: 600, y1: 450, x2: 800, y2: 750 },
  ],
  devices: [
    { def: 'ha-green', name: 'Home Assistant', room: 'salon', at: { x: 20, y: 20 } },
    { def: 'tplink-deco-x50', name: 'Router Wi-Fi', room: 'salon', at: { x: 220, y: 20 } },
    { def: 'sonoff-zbdongle-p', name: 'Coordinador Zigbee', room: 'salon', at: { x: 20, y: 120 } },
    { def: 'ikea-tradfri-e27-ws', name: 'Luz salón', room: 'salon', at: { x: 220, y: 120 }, integration: 'zha' },
    { def: 'aqara-temp-hum', name: 'Clima salón', room: 'salon', at: { x: 20, y: 220 }, integration: 'zha' },
    { def: 'ikea-tradfri-gu10', name: 'Luz cocina', room: 'cocina', at: { x: 20, y: 20 }, integration: 'zha' },
    { def: 'shelly-plug-s-gen3', name: 'Enchufe cafetera', room: 'cocina', at: { x: 20, y: 120 } },
    { def: 'aqara-door-window', name: 'Puerta entrada', room: 'pasillo', at: { x: 20, y: 10 }, integration: 'zha' },
    { def: 'aqara-motion-p1', name: 'Movimiento pasillo', room: 'pasillo', at: { x: 220, y: 10 }, integration: 'zha' },
    { def: 'ikea-tradfri-e27-ws', name: 'Luz pasillo', room: 'pasillo', at: { x: 420, y: 10 }, integration: 'zha' },
    { def: 'ikea-tradfri-e27-ws', name: 'Luz dormitorio', room: 'dormitorio', at: { x: 20, y: 20 }, integration: 'zha' },
    { def: 'ikea-tradfri-e27-ws', name: 'Luz dormitorio 2', room: 'dormitorio2', at: { x: 20, y: 20 }, integration: 'zha' },
    { def: 'aqara-water-leak', name: 'Fuga baño', room: 'bano', at: { x: 20, y: 20 }, integration: 'zha' },
  ],
  automations: [
    auto('plantilla-pasillo', 'Luz del pasillo con movimiento', {
      mode: 'restart',
      triggers: [{ type: 'state', entityId: 'binary_sensor.movimiento_pasillo_motion', to: 'on' }],
      actions: [
        { type: 'service', service: 'light.turn_on', entityId: 'light.luz_pasillo' },
        { type: 'wait_for_trigger', triggers: [{ type: 'state', entityId: 'binary_sensor.movimiento_pasillo_motion', to: 'off' }], timeoutSeconds: 600 },
        { type: 'delay', seconds: 60 },
        { type: 'service', service: 'light.turn_off', entityId: 'light.luz_pasillo' },
      ],
    }),
    auto('plantilla-fuga', 'Aviso de fuga de agua', {
      triggers: [{ type: 'state', entityId: 'binary_sensor.fuga_bano_leak', to: 'on' }],
      actions: [{ type: 'notify', title: 'Fuga de agua', message: 'Se ha detectado agua en el baño' }],
    }),
  ],
  scenes: [
    {
      id: 'plantilla-noche',
      name: 'Buenas noches',
      entities: { 'light.luz_salon': { state: 'off' }, 'light.luz_cocina': { state: 'off' }, 'light.luz_pasillo': { state: 'off' }, 'switch.enchufe_cafetera_switch': { state: 'off' } },
    },
  ],
};

const UNIFAMILIAR: TemplateSpec = {
  id: 'unifamiliar-2-plantas',
  name: 'Unifamiliar de 2 plantas',
  description: 'Planta baja con salón, cocina, entrada y aseo; primera planta con tres dormitorios y baño. Zigbee, Thread, persianas y climatización.',
  floors: ['Planta baja', 'Primera planta'],
  rooms: [
    { key: 'salon', name: 'Salón', floor: 0, x1: 0, y1: 0, x2: 600, y2: 400 },
    { key: 'cocina', name: 'Cocina', floor: 0, x1: 600, y1: 0, x2: 1000, y2: 400 },
    { key: 'entrada', name: 'Entrada', floor: 0, x1: 0, y1: 400, x2: 600, y2: 600 },
    { key: 'aseo', name: 'Aseo', floor: 0, x1: 600, y1: 400, x2: 1000, y2: 600 },
    { key: 'principal', name: 'Dormitorio principal', floor: 1, x1: 0, y1: 0, x2: 600, y2: 400 },
    { key: 'infantil', name: 'Dormitorio infantil', floor: 1, x1: 600, y1: 0, x2: 1000, y2: 400 },
    { key: 'invitados', name: 'Dormitorio invitados', floor: 1, x1: 0, y1: 400, x2: 600, y2: 600 },
    { key: 'bano', name: 'Baño', floor: 1, x1: 600, y1: 400, x2: 1000, y2: 600 },
  ],
  devices: [
    { def: 'ha-green', name: 'Home Assistant', room: 'salon', at: { x: 20, y: 20 } },
    { def: 'tplink-deco-x50', name: 'Router Wi-Fi', room: 'salon', at: { x: 220, y: 20 } },
    { def: 'sonoff-zbdongle-p', name: 'Coordinador Zigbee', room: 'salon', at: { x: 420, y: 20 } },
    { def: 'google-nest-hub-2', name: 'Nest Hub', room: 'cocina', at: { x: 20, y: 20 } },
    { def: 'hue-white-color-e27', name: 'Luz salón', room: 'salon', at: { x: 20, y: 120 }, integration: 'zha' },
    { def: 'netatmo-thermostat', name: 'Termostato', room: 'salon', at: { x: 220, y: 120 } },
    { def: 'sonos-era-100', name: 'Altavoz salón', room: 'salon', at: { x: 420, y: 120 } },
    { def: 'shelly-2pm-gen3-cover', name: 'Persiana salón', room: 'salon', at: { x: 20, y: 220 } },
    { def: 'shelly-1pm-gen3', name: 'Luz cocina', room: 'cocina', at: { x: 20, y: 120 } },
    { def: 'tapo-p110', name: 'Enchufe horno', room: 'cocina', at: { x: 220, y: 120 } },
    { def: 'aqara-door-window', name: 'Puerta entrada', room: 'entrada', at: { x: 20, y: 20 }, integration: 'zha' },
    { def: 'aqara-u200', name: 'Cerradura', room: 'entrada', at: { x: 220, y: 20 } },
    { def: 'reolink-video-doorbell', name: 'Timbre', room: 'entrada', at: { x: 420, y: 20 } },
    { def: 'aqara-motion-p1', name: 'Movimiento entrada', room: 'entrada', at: { x: 20, y: 110 }, integration: 'zha' },
    { def: 'ikea-tradfri-gu10', name: 'Luz entrada', room: 'entrada', at: { x: 220, y: 110 }, integration: 'zha' },
    { def: 'aqara-water-leak', name: 'Fuga aseo', room: 'aseo', at: { x: 20, y: 20 }, integration: 'zha' },
    { def: 'sonoff-s26r2zb', name: 'Enchufe escalera', room: 'aseo', at: { x: 220, y: 20 } },
    { def: 'ikea-tradfri-e27-ws', name: 'Luz dormitorio principal', room: 'principal', at: { x: 20, y: 20 }, integration: 'zha' },
    { def: 'aqara-temp-hum', name: 'Clima dormitorio', room: 'principal', at: { x: 220, y: 20 }, integration: 'zha' },
    { def: 'ikea-fyrtur', name: 'Estor dormitorio', room: 'principal', at: { x: 20, y: 120 }, integration: 'zha' },
    { def: 'ikea-tradfri-e27-ws', name: 'Luz infantil', room: 'infantil', at: { x: 20, y: 20 }, integration: 'zha' },
    { def: 'ikea-tradfri-e27-ws', name: 'Luz invitados', room: 'invitados', at: { x: 20, y: 20 }, integration: 'zha' },
    { def: 'sonoff-snzb-02d', name: 'Sensor baño', room: 'bano', at: { x: 20, y: 20 } },
    { def: 'ikea-tradfri-gu10', name: 'Luz baño', room: 'bano', at: { x: 220, y: 20 }, integration: 'zha' },
  ],
  automations: [
    auto('plantilla-entrada', 'Luz de entrada con movimiento de noche', {
      mode: 'restart',
      triggers: [{ type: 'state', entityId: 'binary_sensor.movimiento_entrada_motion', to: 'on' }],
      conditions: [{ type: 'time', after: '20:00', before: '08:00' }],
      actions: [
        { type: 'service', service: 'light.turn_on', entityId: 'light.luz_entrada' },
        { type: 'delay', seconds: 120 },
        { type: 'service', service: 'light.turn_off', entityId: 'light.luz_entrada' },
      ],
    }),
    auto('plantilla-persianas', 'Bajar persianas al atardecer', {
      triggers: [{ type: 'sun', event: 'sunset' }],
      actions: [
        { type: 'service', service: 'cover.close_cover', entityId: 'cover.persiana_salon_cover' },
        { type: 'service', service: 'cover.close_cover', entityId: 'cover.estor_dormitorio_cover' },
      ],
    }),
    auto('plantilla-timbre', 'Aviso al llamar al timbre', {
      triggers: [{ type: 'state', entityId: 'binary_sensor.timbre_visitor', to: 'on' }],
      actions: [{ type: 'notify', title: 'Timbre', message: 'Hay alguien en la puerta' }],
    }),
  ],
  scenes: [
    {
      id: 'plantilla-cine',
      name: 'Cine',
      entities: { 'light.luz_salon': { state: 'on', attributes: { brightness: 40 } }, 'cover.persiana_salon_cover': { state: 'closed' } },
    },
  ],
};

const OFICINA: TemplateSpec = {
  id: 'oficina-pequena',
  name: 'Oficina pequeña',
  description: 'Recepción, zona de trabajo, sala de reuniones y aseo, con control de presencia, climatización y cierre.',
  floors: ['Oficina'],
  rooms: [
    { key: 'recepcion', name: 'Recepción', floor: 0, x1: 0, y1: 0, x2: 400, y2: 300 },
    { key: 'trabajo', name: 'Zona de trabajo', floor: 0, x1: 400, y1: 0, x2: 1000, y2: 400 },
    { key: 'reuniones', name: 'Sala de reuniones', floor: 0, x1: 0, y1: 300, x2: 400, y2: 600 },
    { key: 'aseo', name: 'Aseo', floor: 0, x1: 400, y1: 400, x2: 700, y2: 600 },
  ],
  devices: [
    { def: 'ha-green', name: 'Home Assistant', room: 'recepcion', at: { x: 20, y: 20 } },
    { def: 'tplink-deco-x50', name: 'Router Wi-Fi', room: 'recepcion', at: { x: 220, y: 20 } },
    { def: 'sonoff-zbdongle-p', name: 'Coordinador Zigbee', room: 'recepcion', at: { x: 20, y: 120 } },
    { def: 'aqara-u200', name: 'Cerradura oficina', room: 'recepcion', at: { x: 220, y: 120 } },
    { def: 'google-nest-hub-2', name: 'Pantalla recepción', room: 'recepcion', at: { x: 20, y: 200 } },
    { def: 'shelly-2pm-gen3', name: 'Luces trabajo', room: 'trabajo', at: { x: 20, y: 20 } },
    { def: 'aqara-fp2', name: 'Presencia trabajo', room: 'trabajo', at: { x: 220, y: 20 } },
    { def: 'tuya-zigbee-trv', name: 'Radiador trabajo', room: 'trabajo', at: { x: 420, y: 20 } },
    { def: 'tuya-zigbee-temp-hum', name: 'Clima trabajo', room: 'trabajo', at: { x: 20, y: 120 } },
    { def: 'sonoff-s26r2zb', name: 'Enchufe impresora', room: 'trabajo', at: { x: 220, y: 120 } },
    { def: 'ikea-tradfri-e27-ws', name: 'Luz reuniones', room: 'reuniones', at: { x: 20, y: 20 }, integration: 'zha' },
    { def: 'samsung-qled-q80', name: 'Pantalla reuniones', room: 'reuniones', at: { x: 220, y: 20 } },
    { def: 'aqara-motion-p1', name: 'Movimiento reuniones', room: 'reuniones', at: { x: 20, y: 120 }, integration: 'zha' },
    { def: 'sonoff-zbminil2', name: 'Luz aseo', room: 'aseo', at: { x: 20, y: 20 } },
    { def: 'sonoff-snzb-03p', name: 'Movimiento aseo', room: 'aseo', at: { x: 220, y: 20 } },
  ],
  automations: [
    auto('plantilla-aseo', 'Luz del aseo con movimiento', {
      mode: 'restart',
      triggers: [{ type: 'state', entityId: 'binary_sensor.movimiento_aseo_motion', to: 'on' }],
      actions: [
        { type: 'service', service: 'switch.turn_on', entityId: 'switch.luz_aseo' },
        { type: 'delay', seconds: 300 },
        { type: 'service', service: 'switch.turn_off', entityId: 'switch.luz_aseo' },
      ],
    }),
    auto('plantilla-cierre', 'Cierre al final de la jornada', {
      triggers: [{ type: 'time', at: '20:00' }],
      conditions: [{ type: 'state', entityId: 'binary_sensor.presencia_trabajo_occupancy', state: 'off' }],
      actions: [
        { type: 'service', service: 'switch.turn_off', entityId: 'switch.luces_trabajo_switch_0' },
        { type: 'service', service: 'switch.turn_off', entityId: 'switch.luces_trabajo_switch_1' },
        { type: 'service', service: 'switch.turn_off', entityId: 'switch.enchufe_impresora' },
        { type: 'service', service: 'lock.lock', entityId: 'lock.cerradura_oficina_lock' },
      ],
    }),
  ],
  scenes: [
    {
      id: 'plantilla-reunion',
      name: 'Reunión',
      entities: { 'light.luz_reuniones': { state: 'on', attributes: { brightness: 200 } }, 'media_player.pantalla_reuniones': { state: 'on' } },
    },
  ],
};

const SPECS: TemplateSpec[] = [PISO, UNIFAMILIAR, OFICINA];

/** Plantillas disponibles (id, nombre y descripción). */
export const HOUSE_TEMPLATES: HouseTemplate[] = SPECS.map(({ id, name, description }) => ({ id, name, description }));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Proyecto nuevo a partir de una plantilla, con ids únicos y conexiones sugeridas. */
export function createFromTemplate(id: string): Project {
  const spec = SPECS.find((s) => s.id === id);
  if (!spec) throw new Error(`Plantilla de casa desconocida: ${id}`);
  const prefix = crypto.randomUUID().slice(0, 8);
  const floors: Floor[] = spec.floors.map((name, level) => ({ id: `${prefix}-planta-${level}`, name, level, pixelsPerMeter: 50 }));
  const floorId = (level: number): string => floors[level]?.id ?? floors[0]?.id ?? '';
  const rooms: Room[] = spec.rooms.map((r) => ({
    id: `${prefix}-${r.key}`,
    floorId: floorId(r.floor),
    name: r.name,
    polygon: [
      { x: r.x1, y: r.y1 },
      { x: r.x2, y: r.y1 },
      { x: r.x2, y: r.y2 },
      { x: r.x1, y: r.y2 },
    ],
  }));
  const devices: Device[] = spec.devices.map((d, i) => {
    const def = getDefinition(d.def, catalog);
    const room = spec.rooms.find((r) => r.key === d.room);
    const protocol = def?.protocols[0];
    const integration = d.integration ?? def?.integrations[0];
    if (!def || !room || !protocol || !integration) throw new Error(`Plantilla ${spec.id}: dispositivo no válido (${d.def})`);
    return {
      id: `${prefix}-dev-${i}`,
      definitionId: d.def,
      name: d.name,
      floorId: floorId(room.floor),
      roomId: `${prefix}-${room.key}`,
      position: { x: room.x1 + d.at.x, y: room.y1 + d.at.y },
      protocol,
      integration,
    };
  });
  const now = new Date().toISOString();
  const base: Project = {
    id: crypto.randomUUID(),
    name: spec.name,
    version: 1,
    createdAt: now,
    updatedAt: now,
    floors,
    rooms,
    devices,
    connections: [],
    automations: clone(spec.automations).map((a) => ({ ...a, id: `${prefix}-${a.id}` })),
    scenes: clone(spec.scenes).map((s) => ({ ...s, id: `${prefix}-${s.id}` })),
    scripts: [],
    people: [{ id: `${prefix}-persona`, name: 'Residente' }],
  };
  return { ...base, connections: suggestConnections(base, catalog) };
}
