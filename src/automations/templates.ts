// Plantillas de automatización tipo blueprint (B7): entradas tipadas y construcción pura de la
// automatización, más sugerencias según los dispositivos del proyecto.
import type { Action, Automation, Condition, DeviceDefinition, EntityDomain, Project, Trigger } from '../types';
import { catalog } from '../devices/catalog';
import { entitiesForDevice } from '../devices/entities';

export type TemplateValue = string | number;
/** Valores de las entradas: entity_id (texto, vacío si es opcional), segundos, "HH:MM", número o %. */
export type TemplateValues = Record<string, TemplateValue>;

export type TemplateInput =
  | {
      key: string;
      label: string;
      kind: 'entity';
      domains: EntityDomain[];
      deviceClass?: string[];
      /** Claves de entidad del catálogo admitidas (p. ej. "action" para mandos). */
      entityKeys?: string[];
      /** Si es opcional, el valor puede ser "" (sin entidad). */
      optional?: boolean;
      /** Texto de ayuda. */
      hint?: string;
    }
  | {
      key: string;
      label: string;
      /** duration: segundos; time: "HH:MM"; number: número; percent: 0-100. */
      kind: 'duration' | 'time' | 'number' | 'percent';
      default: TemplateValue;
      unit?: string;
      min?: number;
      max?: number;
      hint?: string;
    };

export type EntityInput = Extract<TemplateInput, { kind: 'entity' }>;

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  inputs: TemplateInput[];
  /** Automatización principal. */
  build: (inputs: TemplateValues, project: Project) => Omit<Automation, 'id'>;
  /** Si la plantilla genera varias automatizaciones (p. ej. mañana y noche), todas. */
  buildAll?: (inputs: TemplateValues, project: Project) => Omit<Automation, 'id'>[];
  /** Para sugerirla: ¿tiene sentido con estas entidades? (por defecto, si hay candidatas obligatorias). */
  relevant?: (entities: ProjectEntity[]) => boolean;
}

// ---------- Utilidades ----------

function str(v: TemplateValue | undefined): string {
  return v === undefined ? '' : String(v);
}

function num(v: TemplateValue | undefined, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && str(v) !== '' ? n : fallback;
}

export interface ProjectEntity {
  entityId: string;
  name: string;
  domain: EntityDomain;
  deviceClass?: string;
  key: string;
  roomId?: string;
  category: DeviceDefinition['category'];
}

/** Entidades del proyecto con sala y categoría, para elegir candidatas. */
export function projectEntities(project: Pick<Project, 'devices'>, defs: DeviceDefinition[] = catalog): ProjectEntity[] {
  const out: ProjectEntity[] = [];
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def) continue;
    for (const e of entitiesForDevice(device, def)) {
      const item: ProjectEntity = { entityId: e.entityId, name: e.friendlyName, domain: e.definition.domain, key: e.definition.key, category: def.category };
      if (e.definition.deviceClass !== undefined) item.deviceClass = e.definition.deviceClass;
      if (device.roomId !== undefined) item.roomId = device.roomId;
      out.push(item);
    }
  }
  return out;
}

function matches(input: EntityInput, e: ProjectEntity): boolean {
  if (!input.domains.includes(e.domain)) return false;
  if (input.deviceClass && !input.deviceClass.includes(e.deviceClass ?? '')) return false;
  if (input.entityKeys && !input.entityKeys.includes(e.key)) return false;
  return true;
}

/** entity_id del proyecto válidos para una entrada de tipo entidad. */
export function templateCandidates(project: Pick<Project, 'devices'>, defs: DeviceDefinition[], input: EntityInput): string[] {
  return projectEntities(project, defs).filter((e) => matches(input, e)).map((e) => e.entityId);
}

function nameOf(project: Pick<Project, 'devices'>, entityId: string): string {
  return projectEntities(project).find((e) => e.entityId === entityId)?.name ?? entityId;
}

function hhmm(v: TemplateValue | undefined, fallback: string): string {
  const s = str(v).trim();
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return fallback;
  return `${(m[1] ?? '0').padStart(2, '0')}:${m[2] ?? '00'}`;
}

function service(serviceName: string, entityId: string, data?: Record<string, string | number | boolean>): Action {
  return data ? { type: 'service', service: serviceName, entityId, data } : { type: 'service', service: serviceName, entityId };
}

function onOff(entityId: string, on: boolean, data?: Record<string, string | number | boolean>): Action {
  const domain = entityId.split('.')[0] ?? '';
  const svc = domain === 'light' || domain === 'switch' || domain === 'fan' || domain === 'media_player' ? domain : 'homeassistant';
  return service(`${svc}.${on ? 'turn_on' : 'turn_off'}`, entityId, data);
}

/** Aviso con un altavoz (reproduce un mensaje) o una luz (destello). */
function alertAction(entityId: string, message: string): Action[] {
  if (entityId === '') return [];
  const domain = entityId.split('.')[0];
  if (domain === 'media_player') return [service('media_player.play_media', entityId, { media_content_id: message, media_content_type: 'music' })];
  if (domain === 'light') return [service('light.turn_on', entityId, { flash: 'long' })];
  return [];
}

const automation = (
  name: string,
  triggers: Trigger[],
  actions: Action[],
  extra: { conditions?: Condition[]; mode?: Automation['mode'] } = {},
): Omit<Automation, 'id'> => ({ name, enabled: true, mode: extra.mode ?? 'single', triggers, conditions: extra.conditions ?? [], actions });

const NOTIFIER: EntityInput = { key: 'notifier', label: 'Avisar con (altavoz o luz)', kind: 'entity', domains: ['media_player', 'light'], optional: true, hint: 'Opcional: si no eliges ninguno, el aviso queda en el registro' };
const MOTION_CLASSES = ['motion', 'occupancy', 'presence'];

// ---------- Plantillas ----------

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'motion_light',
    name: 'Luz con movimiento',
    description: 'Enciende una luz al detectar movimiento y la apaga tras un tiempo sin movimiento.',
    inputs: [
      { key: 'motion', label: 'Sensor de movimiento', kind: 'entity', domains: ['binary_sensor'], deviceClass: MOTION_CLASSES },
      { key: 'light', label: 'Luz', kind: 'entity', domains: ['light', 'switch'] },
      { key: 'off_after', label: 'Apagar tras', kind: 'duration', default: 120, unit: 's', min: 5 },
    ],
    build: (v, project) => {
      const motion = str(v.motion);
      const light = str(v.light);
      return automation(
        `${nameOf(project, light)} con movimiento`,
        [{ type: 'state', entityId: motion, to: 'on' }],
        [onOff(light, true), { type: 'delay', seconds: num(v.off_after, 120) }, onOff(light, false)],
        { mode: 'restart' },
      );
    },
  },
  {
    id: 'door_left_open',
    name: 'Aviso de puerta abierta',
    description: 'Avisa si una puerta o ventana se queda abierta más de un tiempo.',
    inputs: [
      { key: 'door', label: 'Puerta o ventana', kind: 'entity', domains: ['binary_sensor'], deviceClass: ['door', 'window', 'opening', 'garage_door'] },
      { key: 'duration', label: 'Abierta durante', kind: 'duration', default: 300, unit: 's', min: 10 },
      NOTIFIER,
    ],
    build: (v, project) => {
      const door = str(v.door);
      return automation(
        `Aviso: ${nameOf(project, door)} abierta`,
        [{ type: 'state', entityId: door, to: 'on', for: num(v.duration, 300) }],
        alertAction(str(v.notifier), `${nameOf(project, door)} lleva tiempo abierta`),
      );
    },
  },
  {
    id: 'water_leak',
    name: 'Fuga de agua: cortar y avisar',
    description: 'Si un sensor detecta agua, corta el enchufe o la válvula y avisa.',
    inputs: [
      { key: 'leak', label: 'Sensor de fuga', kind: 'entity', domains: ['binary_sensor'], deviceClass: ['moisture'] },
      { key: 'shutoff', label: 'Enchufe o válvula a cortar', kind: 'entity', domains: ['switch'] },
      NOTIFIER,
    ],
    build: (v, project) => {
      const leak = str(v.leak);
      return automation(
        `Fuga en ${nameOf(project, leak)}: cortar y avisar`,
        [{ type: 'state', entityId: leak, to: 'on' }],
        [service('switch.turn_off', str(v.shutoff)), ...alertAction(str(v.notifier), `Fuga de agua detectada en ${nameOf(project, leak)}`)],
      );
    },
  },
  {
    id: 'leave_home',
    name: 'Apagarlo todo al salir',
    description: 'Con una pulsación del mando o a una hora: apaga luces, televisores y altavoces, cierra las cerraduras y baja la calefacción.',
    inputs: [
      { key: 'remote', label: 'Mando (pulsación simple)', kind: 'entity', domains: ['sensor'], entityKeys: ['action'], optional: true },
      { key: 'time', label: 'O a la hora', kind: 'time', default: '09:00' },
      { key: 'temperature', label: 'Consigna al salir', kind: 'number', default: 17, unit: '°C', min: 5, max: 25 },
    ],
    build: (v, project) => {
      const triggers: Trigger[] = [];
      const remote = str(v.remote);
      if (remote !== '') triggers.push({ type: 'state', entityId: remote, to: 'single' });
      triggers.push({ type: 'time', at: hhmm(v.time, '09:00') });
      const entities = projectEntities(project);
      const actions: Action[] = [];
      for (const e of entities) {
        if (e.domain === 'light' || e.domain === 'fan' || e.domain === 'media_player') actions.push(onOff(e.entityId, false));
        else if (e.domain === 'switch' && e.category === 'switch') actions.push(onOff(e.entityId, false));
        else if (e.domain === 'lock') actions.push(service('lock.lock', e.entityId));
        else if (e.domain === 'climate') actions.push(service('climate.set_temperature', e.entityId, { temperature: num(v.temperature, 17) }));
      }
      return automation('Apagarlo todo al salir', triggers, actions);
    },
    relevant: (entities) => entities.some((e) => e.domain === 'light' || e.domain === 'media_player'),
  },
  {
    id: 'covers_sun',
    name: 'Persianas con el sol',
    description: 'Sube la persiana al amanecer y la baja al atardecer, con desplazamiento en minutos.',
    inputs: [
      { key: 'cover', label: 'Persiana', kind: 'entity', domains: ['cover'] },
      { key: 'sunrise_offset', label: 'Desplazamiento al amanecer', kind: 'number', default: 0, unit: 'min', min: -240, max: 240 },
      { key: 'sunset_offset', label: 'Desplazamiento al atardecer', kind: 'number', default: 0, unit: 'min', min: -240, max: 240 },
    ],
    build: (v, project) => coversSun(v, project)[1] ?? coversSun(v, project)[0] ?? automation('Persianas', [], []),
    buildAll: (v, project) => coversSun(v, project),
  },
  {
    id: 'thermostat_schedule',
    name: 'Termostato por horario',
    description: 'Consigna de confort por la mañana y más baja por la noche.',
    inputs: [
      { key: 'climate', label: 'Termostato', kind: 'entity', domains: ['climate'] },
      { key: 'morning', label: 'Hora de confort', kind: 'time', default: '07:00' },
      { key: 'comfort', label: 'Consigna de confort', kind: 'number', default: 21, unit: '°C', min: 5, max: 30 },
      { key: 'night', label: 'Hora de noche', kind: 'time', default: '23:00' },
      { key: 'eco', label: 'Consigna de noche', kind: 'number', default: 17, unit: '°C', min: 5, max: 30 },
    ],
    build: (v, project) => thermostat(v, project)[0] ?? automation('Termostato', [], []),
    buildAll: (v, project) => thermostat(v, project),
  },
  {
    id: 'presence_simulation',
    name: 'Simulación de presencia',
    description: 'Enciende una luz por la tarde y la apaga más tarde para que parezca que hay alguien en casa.',
    inputs: [
      { key: 'light', label: 'Luz', kind: 'entity', domains: ['light', 'switch'] },
      { key: 'start', label: 'Encender a las', kind: 'time', default: '20:30' },
      { key: 'duration', label: 'Durante', kind: 'duration', default: 9000, unit: 's', min: 60 },
    ],
    build: (v, project) => {
      const light = str(v.light);
      return automation(
        `Simulación de presencia: ${nameOf(project, light)}`,
        [{ type: 'time', at: hhmm(v.start, '20:30') }],
        [onOff(light, true), { type: 'delay', seconds: num(v.duration, 9000) }, onOff(light, false)],
      );
    },
  },
  {
    id: 'night_light',
    name: 'Luz nocturna tenue',
    description: 'Entre dos horas, el movimiento enciende una luz con poco brillo y la apaga al rato.',
    inputs: [
      { key: 'motion', label: 'Sensor de movimiento', kind: 'entity', domains: ['binary_sensor'], deviceClass: MOTION_CLASSES },
      { key: 'light', label: 'Luz', kind: 'entity', domains: ['light'] },
      { key: 'from', label: 'Desde', kind: 'time', default: '23:00' },
      { key: 'to', label: 'Hasta', kind: 'time', default: '07:00' },
      { key: 'brightness', label: 'Brillo', kind: 'percent', default: 10, unit: '%', min: 1, max: 100 },
      { key: 'off_after', label: 'Apagar tras', kind: 'duration', default: 60, unit: 's', min: 5 },
    ],
    build: (v, project) => {
      const light = str(v.light);
      return automation(
        `Luz nocturna: ${nameOf(project, light)}`,
        [{ type: 'state', entityId: str(v.motion), to: 'on' }],
        [onOff(light, true, { brightness_pct: num(v.brightness, 10) }), { type: 'delay', seconds: num(v.off_after, 60) }, onOff(light, false)],
        { mode: 'restart', conditions: [{ type: 'time', after: hhmm(v.from, '23:00'), before: hhmm(v.to, '07:00') }] },
      );
    },
  },
  {
    id: 'low_battery',
    name: 'Aviso de batería baja',
    description: 'Avisa cuando la batería de un sensor (o de todos, si no eliges ninguno) baja de un umbral.',
    inputs: [
      { key: 'battery', label: 'Batería', kind: 'entity', domains: ['sensor'], deviceClass: ['battery'], optional: true, hint: 'Vacío: todas las baterías del proyecto' },
      { key: 'threshold', label: 'Umbral', kind: 'percent', default: 20, unit: '%', min: 1, max: 99 },
      NOTIFIER,
    ],
    build: (v, project) => {
      const threshold = num(v.threshold, 20);
      const chosen = str(v.battery);
      const ids = chosen !== '' ? [chosen] : projectEntities(project).filter((e) => e.domain === 'sensor' && e.deviceClass === 'battery').map((e) => e.entityId);
      return automation(
        chosen !== '' ? `Batería baja: ${nameOf(project, chosen)}` : 'Batería baja en algún dispositivo',
        ids.map((entityId) => ({ type: 'numeric_state', entityId, below: threshold })),
        alertAction(str(v.notifier), `Batería por debajo del ${threshold} %`),
      );
    },
    relevant: (entities) => entities.some((e) => e.domain === 'sensor' && e.deviceClass === 'battery'),
  },
];

function coversSun(v: TemplateValues, project: Project): Omit<Automation, 'id'>[] {
  const cover = str(v.cover);
  const name = nameOf(project, cover);
  const sunrise: Trigger = { type: 'sun', event: 'sunrise' };
  const sunset: Trigger = { type: 'sun', event: 'sunset' };
  const up = num(v.sunrise_offset, 0);
  const down = num(v.sunset_offset, 0);
  if (up) sunrise.offsetMinutes = up;
  if (down) sunset.offsetMinutes = down;
  return [
    automation(`Subir ${name} al amanecer`, [sunrise], [service('cover.open_cover', cover)]),
    automation(`Bajar ${name} al atardecer`, [sunset], [service('cover.close_cover', cover)]),
  ];
}

function thermostat(v: TemplateValues, project: Project): Omit<Automation, 'id'>[] {
  const climate = str(v.climate);
  const name = nameOf(project, climate);
  return [
    automation(`${name}: confort por la mañana`, [{ type: 'time', at: hhmm(v.morning, '07:00') }], [service('climate.set_temperature', climate, { temperature: num(v.comfort, 21) })]),
    automation(`${name}: consigna de noche`, [{ type: 'time', at: hhmm(v.night, '23:00') }], [service('climate.set_temperature', climate, { temperature: num(v.eco, 17) })]),
  ];
}

export function findTemplate(id: string): AutomationTemplate | undefined {
  return AUTOMATION_TEMPLATES.find((t) => t.id === id);
}

/** Valores por defecto de las entradas (las de entidad, vacías). */
export function defaultTemplateValues(template: AutomationTemplate): TemplateValues {
  const values: TemplateValues = {};
  for (const input of template.inputs) values[input.key] = input.kind === 'entity' ? '' : input.default;
  return values;
}

/** Entradas obligatorias sin rellenar (mensajes en español); vacío si se puede construir. */
export function missingTemplateInputs(template: AutomationTemplate, values: TemplateValues): string[] {
  return template.inputs.filter((i) => i.kind === 'entity' && !i.optional && str(values[i.key]) === '').map((i) => `Falta «${i.label}»`);
}

/** Todas las automatizaciones que genera la plantilla (sin id). */
export function buildTemplate(template: AutomationTemplate, values: TemplateValues, project: Project): Omit<Automation, 'id'>[] {
  const full = { ...defaultTemplateValues(template), ...values };
  return template.buildAll ? template.buildAll(full, project) : [template.build(full, project)];
}

// ---------- Sugerencias ----------

export interface TemplateSuggestion {
  templateId: string;
  name: string;
  /** Por qué tiene sentido, en español. */
  reason: string;
  /** Valores propuestos (entidades elegidas, preferiblemente de la misma sala, y valores por defecto). */
  values: TemplateValues;
}

/**
 * Primera entidad propuesta: la que tiene en su sala candidatas para más entradas de la
 * plantilla; a igualdad, un sensor dedicado antes que, p. ej., el movimiento de una cámara.
 */
function bestFirst(template: AutomationTemplate, candidates: ProjectEntity[], entities: ProjectEntity[]): ProjectEntity | undefined {
  const others = template.inputs.filter((i): i is EntityInput => i.kind === 'entity' && !i.optional).slice(1);
  const score = (c: ProjectEntity): number =>
    others.filter((i) => c.roomId !== undefined && entities.some((e) => e !== c && e.roomId === c.roomId && matches(i, e))).length * 2 + (c.category === 'sensor' ? 1 : 0);
  return [...candidates].sort((a, b) => score(b) - score(a))[0];
}

/** Plantillas que tienen sentido con los dispositivos del proyecto, con valores propuestos. */
export function suggestTemplates(project: Project, defs: DeviceDefinition[]): TemplateSuggestion[] {
  const entities = projectEntities(project, defs);
  const roomName = (id: string | undefined): string | undefined => project.rooms.find((r) => r.id === id)?.name;
  const result: TemplateSuggestion[] = [];
  for (const template of AUTOMATION_TEMPLATES) {
    const values = defaultTemplateValues(template);
    const chosen: ProjectEntity[] = [];
    let possible = true;
    for (const input of template.inputs) {
      if (input.kind !== 'entity') continue;
      const candidates = entities.filter((e) => matches(input, e));
      if (candidates.length === 0) {
        if (!input.optional) possible = false;
        continue;
      }
      if (input.optional && input.key !== 'remote') continue;
      const room = chosen[0]?.roomId;
      const pick =
        chosen.length === 0
          ? bestFirst(template, candidates, entities)
          : (candidates.find((c) => room !== undefined && c.roomId === room && !chosen.includes(c)) ?? candidates.find((c) => !chosen.includes(c)) ?? candidates[0]);
      if (pick) {
        values[input.key] = pick.entityId;
        chosen.push(pick);
      }
    }
    if (!possible || (template.relevant && !template.relevant(entities))) continue;
    const names = chosen.map((c) => c.name);
    const sameRoom = chosen.length > 1 && chosen.every((c) => c.roomId !== undefined && c.roomId === chosen[0]?.roomId) ? roomName(chosen[0]?.roomId) : undefined;
    const reason =
      names.length === 0
        ? 'Útil con los dispositivos del proyecto'
        : `Tienes ${names.join(' y ')}${sameRoom ? ` en ${sameRoom}` : ''}`;
    result.push({ templateId: template.id, name: template.name, reason, values });
  }
  return result;
}
