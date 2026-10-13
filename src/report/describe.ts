import { findHelperByEntity } from '../simulation/helpers';
import { WEEKDAYS } from '../automations/tanda3/stepFlags';
import { describeTimePattern } from '../automations/tanda3/timePattern';
// Automatizaciones en lenguaje natural para el cliente (Tanda 2): «Cuando se detecta movimiento
// en el pasillo y es de noche, enciende la luz del pasillo al 30 % durante 2 minutos».
// Lógica pura, sin React.
import type {
  Action,
  Automation,
  Condition,
  Device,
  DeviceDefinition,
  EntityDefinition,
  EntityStateValue,
  Project,
  Room,
  ServiceAction,
  SunEvent,
  Trigger,
} from '../types';
import { catalog } from '../devices/catalog';
import { entitiesForDevice } from '../devices/entities';
import { foldText } from '../devices/text';
import { BUTTON_ACTION_LABELS, HVAC_MODE_LABELS, labelOf, PRESET_LABELS } from '../devices/labels';
import { stateLabel } from '../devices/stateLabels';
import { findScene, findScript } from '../simulation/engine';
import { groupEntityId, personEntityId, projectZones, zoneEntityId } from '../simulation/logic';
import { serviceName } from '../simulation/serviceCatalog';
import { serviceAreaIds, serviceEntityIds } from '../automations/walk';
import { guessFeminine, plural } from '../ui/plural';

interface EntityInfo {
  device: Device;
  def: DeviceDefinition;
  entity: EntityDefinition;
  friendlyName: string;
  room?: Room;
}

interface Ctx {
  project: Project;
  entities: Map<string, EntityInfo>;
}

function buildCtx(project: Project, defs: DeviceDefinition[]): Ctx {
  const entities = new Map<string, EntityInfo>();
  for (const device of project.devices) {
    const def = defs.find((d) => d.id === device.definitionId);
    if (!def) continue;
    const room = project.rooms.find((r) => r.id === device.roomId);
    for (const e of entitiesForDevice(device, def)) {
      const info: EntityInfo = { device, def, entity: e.definition, friendlyName: e.friendlyName };
      if (room) info.room = room;
      entities.set(e.entityId, info);
    }
  }
  return { project, entities };
}

// ---------- Gramática ----------

const lowerFirst = (s: string): string => {
  // No se pasan a minúscula siglas ni nombres con varias mayúsculas («TV», «HomePod»).
  const first = s.split(/\s+/)[0] ?? '';
  if (first.length > 1 && /[A-ZÁÉÍÓÚÑ]/.test(first.slice(1))) return s;
  return s === '' ? s : (s[0]?.toLowerCase() ?? '') + s.slice(1);
};

/** «el pasillo», «la cocina». */
function withArticle(noun: string): string {
  return `${guessFeminine(noun) ? 'la' : 'el'} ${lowerFirst(noun)}`;
}

/** «del pasillo», «de la cocina». */
function ofPlace(noun: string): string {
  const phrase = withArticle(noun);
  return phrase.startsWith('el ') ? `del ${phrase.slice(3)}` : `de ${phrase}`;
}

/** «en el pasillo», «en la cocina». */
const inPlace = (noun: string): string => `en ${withArticle(noun)}`;

const quoted = (s: string): string => `«${s}»`;

/** «A», «A y B», «A, B y C». */
export function joinList(items: string[], conj = 'y'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1] ?? ''}`;
}

/** 120 → «2 minutos»; 90 → «1 minuto y 30 segundos»; 3600 → «1 hora». */
export function durationText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} ${plural(h, 'hora', 'horas')}`);
  if (m) parts.push(`${m} ${plural(m, 'minuto', 'minutos')}`);
  if (sec || parts.length === 0) parts.push(`${sec} ${plural(sec, 'segundo', 'segundos')}`);
  return joinList(parts);
}

const num = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');

// ---------- Entidades ----------

/**
 * Frase nominal de una entidad: «la luz del pasillo» si el nombre del dispositivo es
 * «<Algo> <sala>»; si no, el nombre amigable entre comillas.
 */
function entityPhrase(ctx: Ctx, entityId: string): string {
  if (entityId === '') return 'la entidad sin indicar';
  const info = ctx.entities.get(entityId);
  if (!info) {
    const person = (ctx.project.people ?? []).find((p) => personEntityId(p) === entityId);
    if (person) return person.name;
    const group = (ctx.project.groups ?? []).find((g) => groupEntityId(g) === entityId);
    if (group) return `el grupo ${quoted(group.name)}`;
    if (entityId.startsWith('zone.')) return `la zona ${quoted(entityId.slice(5))}`;
    const helper = findHelperByEntity(ctx.project, entityId);
    if (helper) return `${quoted(helper.name)}`;
    return entityId;
  }
  return namePhrase(info, info.friendlyName);
}

/** Frase del dispositivo entero («el mando del salón»), sin el nombre de la entidad. */
function devicePhrase(ctx: Ctx, entityId: string): string {
  const info = ctx.entities.get(entityId);
  return info ? namePhrase(info, info.device.name) : entityPhrase(ctx, entityId);
}

function namePhrase(info: EntityInfo, friendlyName: string): string {
  const { device, room } = info;
  if (room && friendlyName === device.name) {
    const name = foldText(device.name);
    const roomName = foldText(room.name);
    if (name.endsWith(` ${roomName}`)) {
      const prefix = device.name.slice(0, device.name.length - room.name.length).trim();
      if (prefix !== '') return `${withArticle(prefix)} ${ofPlace(room.name)}`;
    }
  }
  return quoted(friendlyName);
}

/** Dónde ocurre un evento: «en el pasillo» o «en «Sensor 3»». */
function wherePhrase(ctx: Ctx, entityId: string): string {
  const info = ctx.entities.get(entityId);
  if (info?.room) return inPlace(info.room.name);
  return `en ${info ? quoted(info.device.name) : entityId}`;
}

const MAGNITUDES: Record<string, string> = {
  temperature: 'la temperatura',
  humidity: 'la humedad',
  illuminance: 'la luminosidad',
  carbon_dioxide: 'el CO₂',
  pressure: 'la presión',
  sound_pressure: 'el ruido',
  battery: 'la batería',
  power: 'el consumo',
  energy: 'la energía',
};

/** «la temperatura del dormitorio», «la batería de «Sensor»». */
function quantityPhrase(ctx: Ctx, entityId: string): string {
  const info = ctx.entities.get(entityId);
  const magnitude = MAGNITUDES[info?.entity.deviceClass ?? ''];
  if (!info || !magnitude) return entityPhrase(ctx, entityId);
  const perRoom = ['temperature', 'humidity', 'illuminance', 'carbon_dioxide', 'pressure', 'sound_pressure'].includes(info.entity.deviceClass ?? '');
  if (perRoom && info.room) return `${magnitude} ${ofPlace(info.room.name)}`;
  return `${magnitude} de ${quoted(info.device.name)}`;
}

function unitOf(ctx: Ctx, entityId: string): string {
  const u = ctx.entities.get(entityId)?.entity.unit;
  if (!u) return '';
  return u === '%' ? ' %' : ` ${u}`;
}

const stateText = (v: EntityStateValue): string => (v === true ? 'on' : v === false ? 'off' : String(v));

function labelFor(ctx: Ctx, entityId: string, value: EntityStateValue): string {
  return stateLabel(entityId, value, ctx.entities.get(entityId)?.entity.deviceClass).toLowerCase();
}

function personName(ctx: Ctx, personId: string): string {
  return (ctx.project.people ?? []).find((p) => p.id === personId)?.name ?? 'Una persona que ya no existe';
}

function zonePlace(ctx: Ctx, zoneId: string): { enter: string; at: string; leave: string } {
  const zone = projectZones(ctx.project).find((z) => z.id === zoneId);
  if (!zone || zone.kind === 'home') return { enter: 'llega a casa', at: 'está en casa', leave: 'sale de casa' };
  return { enter: `llega a ${quoted(zone.name)}`, at: `está en ${quoted(zone.name)}`, leave: `sale de ${quoted(zone.name)}` };
}

/** Personas en una zona (estado numérico de zone.*): «no queda nadie en casa». */
function zoneCountText(ctx: Ctx, entityId: string, above: number | undefined, below: number | undefined): string {
  const zone = projectZones(ctx.project).find((z) => zoneEntityId(z) === entityId);
  const place = !zone || zone.kind === 'home' ? 'casa' : quoted(zone.name);
  if (below !== undefined && below <= 1 && above === undefined) return `no queda nadie en ${place}`;
  if (above !== undefined && above < 1 && below === undefined) return `hay alguien en ${place}`;
  return `el número de personas en ${place} ${rangeText(above, below, '', { above: 'es mayor que', below: 'es menor que', between: 'está entre' })}`;
}

// ---------- Disparadores ----------

const MOTION = ['motion', 'occupancy', 'presence'];
const OPENING = ['door', 'window', 'opening', 'garage_door'];

function openingNoun(ctx: Ctx, entityId: string): { phrase: string; feminine: boolean } {
  const info = ctx.entities.get(entityId);
  const dc = info?.entity.deviceClass ?? '';
  const noun = dc === 'door' ? 'puerta' : dc === 'window' ? 'ventana' : dc === 'garage_door' ? 'puerta del garaje' : '';
  if (noun && info?.room) return { phrase: `la ${noun} ${ofPlace(info.room.name)}`, feminine: true };
  const phrase = entityPhrase(ctx, entityId);
  return { phrase, feminine: noun !== '' || phrase.startsWith('la ') };
}

function describeStateTrigger(ctx: Ctx, t: Extract<Trigger, { type: 'state' }>): string {
  const info = ctx.entities.get(t.entityId);
  const domain = t.entityId.split('.')[0] ?? '';
  const dc = info?.entity.deviceClass ?? '';
  const to = t.to === undefined ? undefined : stateText(t.to);
  const forText = t.for ? ` durante ${durationText(t.for)}` : '';
  if (domain === 'binary_sensor' && MOTION.includes(dc) && (to === 'on' || to === 'off')) {
    const what = dc === 'motion' ? 'movimiento' : 'presencia';
    if (to === 'on') return `se detecta ${what} ${wherePhrase(ctx, t.entityId)}${forText}`;
    return t.for ? `no hay ${what} ${wherePhrase(ctx, t.entityId)}${forText}` : `deja de detectarse ${what} ${wherePhrase(ctx, t.entityId)}`;
  }
  if (domain === 'binary_sensor' && OPENING.includes(dc) && (to === 'on' || to === 'off')) {
    const { phrase, feminine } = openingNoun(ctx, t.entityId);
    const adj = to === 'on' ? (feminine ? 'abierta' : 'abierto') : feminine ? 'cerrada' : 'cerrado';
    if (t.for) return `${phrase} lleva ${adj} ${durationText(t.for)}`;
    return `se ${to === 'on' ? 'abre' : 'cierra'} ${phrase}`;
  }
  if (domain === 'binary_sensor' && dc === 'moisture' && to === 'on') return `se detecta una fuga de agua ${wherePhrase(ctx, t.entityId)}${forText}`;
  if (domain === 'binary_sensor' && dc === 'smoke' && to === 'on') return `se detecta humo ${wherePhrase(ctx, t.entityId)}${forText}`;
  if (domain === 'sensor' && t.entityId.endsWith('_action') && to !== undefined) {
    return `se pulsa ${devicePhrase(ctx, t.entityId)} (${labelOf(BUTTON_ACTION_LABELS, to).toLowerCase()})`;
  }
  if (domain === 'person' && (to === 'home' || to === 'not_home')) return `${entityPhrase(ctx, t.entityId)} ${to === 'home' ? 'llega a casa' : 'sale de casa'}`;
  const phrase = entityPhrase(ctx, t.entityId);
  const simple: Record<string, Record<string, string>> = {
    light: { on: 'se enciende', off: 'se apaga' },
    switch: { on: 'se enciende', off: 'se apaga' },
    fan: { on: 'se enciende', off: 'se apaga' },
    lock: { locked: 'se bloquea', unlocked: 'se desbloquea', jammed: 'se atasca' },
    cover: { open: 'se abre', closed: 'se cierra' },
  };
  const verb = to === undefined ? undefined : simple[domain]?.[to];
  if (verb) return `${verb} ${phrase}${forText}`;
  if (to !== undefined) return `${phrase} pasa a ${quoted(labelFor(ctx, t.entityId, to))}${forText}`;
  if (t.from !== undefined) return `${phrase} deja de estar ${quoted(labelFor(ctx, t.entityId, t.from))}`;
  return `${phrase} cambia de estado`;
}

function rangeText(above: number | undefined, below: number | undefined, unit: string, verbs: { above: string; below: string; between: string }): string {
  if (above !== undefined && below !== undefined) return `${verbs.between} ${num(above)} y ${num(below)}${unit}`;
  if (above !== undefined) return `${verbs.above} ${num(above)}${unit}`;
  if (below !== undefined) return `${verbs.below} ${num(below)}${unit}`;
  return 'cambia';
}

function sunTriggerText(event: SunEvent, offsetMinutes = 0): string {
  const noun = event === 'sunset' ? 'la puesta de sol' : 'el amanecer';
  if (!offsetMinutes) return event === 'sunset' ? 'se pone el sol' : 'sale el sol';
  const d = durationText(Math.abs(offsetMinutes) * 60);
  return offsetMinutes < 0 ? `faltan ${d} para ${noun}` : `han pasado ${d} desde ${noun}`;
}

/** Disparador como oración subordinada («se detecta movimiento en el pasillo»). */
function describeTriggerClause(t: Trigger, ctx: Ctx): string {
  switch (t.type) {
    case 'state':
      return describeStateTrigger(ctx, t);
    case 'numeric_state':
      if (t.entityId.startsWith('zone.')) return zoneCountText(ctx, t.entityId, t.above, t.below).replace(/^no queda/, 'ya no queda');
      return `${quantityPhrase(ctx, t.entityId)} ${rangeText(t.above, t.below, unitOf(ctx, t.entityId), { above: 'supera', below: 'baja de', between: 'queda entre' })}`;
    case 'time':
      return `son las ${t.at}`;
    case 'sun':
      return sunTriggerText(t.event, t.offsetMinutes);
    case 'zone': {
      const z = zonePlace(ctx, t.zoneId);
      return `${personName(ctx, t.personId)} ${t.event === 'enter' ? z.enter : z.leave}`;
    }
    case 'device_action':
      return `se pulsa ${devicePhrase(ctx, t.entityId)} (${labelOf(BUTTON_ACTION_LABELS, t.action).toLowerCase()})`;
    case 'time_pattern':
      return `toca según el patrón de hora (${describeTimePattern(t)})`;
    case 'homeassistant':
      return t.event === 'start' ? 'arranca Home Assistant' : 'se para Home Assistant';
    case 'event':
      return `llega el evento ${quoted(t.eventType || 'sin nombre')}`;
    case 'conversation':
      return `alguien dice al asistente ${t.command.map((c) => quoted(c)).join(' o ') || 'una frase'}`;
  }
}

// ---------- Condiciones ----------

function sunConditionText(c: Extract<Condition, { type: 'sun' }>): string {
  if (c.after === 'sunset' && c.before === 'sunrise') return 'es de noche';
  if (c.after === 'sunrise' && c.before === 'sunset') return 'es de día';
  if (c.after === 'sunset') return 'ya se ha puesto el sol';
  if (c.after === 'sunrise') return 'ya ha salido el sol';
  if (c.before === 'sunrise') return 'aún no ha salido el sol';
  if (c.before === 'sunset') return 'aún no se ha puesto el sol';
  return 'se cumple la condición del sol';
}

function describeConditionClause(c: Condition, ctx: Ctx): string {
  switch (c.type) {
    case 'state': {
      const domain = c.entityId.split('.')[0] ?? '';
      const since = c.for ? ` desde hace al menos ${durationText(c.for)}` : '';
      if (domain === 'person') return `${entityPhrase(ctx, c.entityId)} está ${stateText(c.state) === 'home' ? 'en casa' : 'fuera'}${since}`;
      return `${entityPhrase(ctx, c.entityId)} está ${quoted(labelFor(ctx, c.entityId, c.state))}${since}`;
    }
    case 'numeric_state':
      if (c.entityId.startsWith('zone.')) return zoneCountText(ctx, c.entityId, c.above, c.below);
      return `${quantityPhrase(ctx, c.entityId)} ${rangeText(c.above, c.below, unitOf(ctx, c.entityId), { above: 'está por encima de', below: 'está por debajo de', between: 'está entre' })}`;
    case 'time': {
      const days = c.weekday && c.weekday.length > 0 ? ` (${joinList(WEEKDAYS.filter((d) => c.weekday?.includes(d.key)).map((d) => d.name), 'o')})` : '';
      if (c.after && c.before) return `es entre las ${c.after} y las ${c.before}${days}`;
      if (c.after) return `son más de las ${c.after}${days}`;
      if (c.before) return `son menos de las ${c.before}${days}`;
      return days ? `es${days}` : 'es cualquier hora';
    }
    case 'sun':
      return sunConditionText(c);
    case 'and':
      return joinList(c.conditions.map((x) => describeConditionClause(x, ctx)));
    case 'or':
      return `(${joinList(c.conditions.map((x) => describeConditionClause(x, ctx)), 'o')})`;
    case 'not':
      return `no ${c.conditions.length === 1 ? 'se cumple que' : 'se cumple ninguna de estas:'} ${joinList(c.conditions.map((x) => describeConditionClause(x, ctx)), 'o')}`;
    case 'zone':
      return `${personName(ctx, c.personId)} ${zonePlace(ctx, c.zoneId).at}`;
    case 'trigger':
      return `el aviso viene ${c.ids.length === 1 ? 'del disparador' : 'de los disparadores'} ${joinList(c.ids.map(quoted), 'o')}`;
  }
}

// ---------- Acciones ----------

const AREA_NOUNS: Record<string, string> = { light: 'las luces', switch: 'los interruptores', cover: 'las persianas', climate: 'los termostatos', media_player: 'los reproductores', fan: 'los ventiladores', lock: 'las cerraduras' };

function targetsPhrase(ctx: Ctx, a: ServiceAction): string {
  const domain = a.service.split('.')[0] ?? '';
  const parts = serviceEntityIds(a).map((id) => entityPhrase(ctx, id));
  for (const roomId of serviceAreaIds(a)) {
    const room = ctx.project.rooms.find((r) => r.id === roomId);
    parts.push(`${AREA_NOUNS[domain] ?? 'los dispositivos'} ${room ? ofPlace(room.name) : 'de un área que ya no existe'}`);
  }
  return joinList(parts);
}

function numberData(a: ServiceAction, key: string): number | undefined {
  const v = a.data?.[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function lightOptions(a: ServiceAction): string {
  const parts: string[] = [];
  const pct = numberData(a, 'brightness_pct') ?? (numberData(a, 'brightness') === undefined ? undefined : Math.round(((numberData(a, 'brightness') ?? 0) / 255) * 100));
  if (pct !== undefined) parts.push(` al ${pct} %`);
  const kelvin = numberData(a, 'color_temp_kelvin');
  if (kelvin !== undefined) parts.push(` con luz de ${kelvin} K`);
  if (a.data?.rgb_color !== undefined) parts.push(' en color');
  return parts.join('');
}

function notifyText(title: string | undefined, message: string): string {
  return title ? `envía la notificación ${quoted(title)}` : `envía la notificación ${quoted(message)}`;
}

function describeService(ctx: Ctx, a: ServiceAction): string {
  const [domain = '', name = ''] = a.service.split('.');
  const target = targetsPhrase(ctx, a);
  if (domain === 'notify' || domain === 'persistent_notification') {
    const title = a.data?.title;
    const message = a.data?.message;
    return notifyText(title === undefined ? undefined : String(title), message === undefined ? '' : String(message));
  }
  if (domain === 'scene' && name === 'turn_on') return `activa la escena ${quoted(findScene(ctx.project, a.entityId)?.name ?? a.entityId)}`;
  if (domain === 'script') {
    const ref = name === 'turn_on' ? a.entityId : a.service;
    return `ejecuta el script ${quoted(findScript(ctx.project, ref)?.name ?? ref)}`;
  }
  switch (name) {
    case 'turn_on':
      return `enciende ${target}${domain === 'light' ? lightOptions(a) : ''}`;
    case 'turn_off':
      return `apaga ${target}`;
    case 'toggle':
      return `enciende o apaga ${target}`;
    case 'open_cover':
      return `sube ${target}`;
    case 'close_cover':
      return `baja ${target}`;
    case 'stop_cover':
      return `para ${target}`;
    case 'set_cover_position':
      return `pone ${target} al ${num(numberData(a, 'position') ?? 0)} %`;
    case 'lock':
      return `bloquea ${target}`;
    case 'unlock':
      return `desbloquea ${target}`;
    case 'open':
      return `abre ${target}`;
    case 'set_temperature':
      return `pone ${target} a ${num(numberData(a, 'temperature') ?? 0)} °C`;
    case 'set_hvac_mode':
      return `pone ${target} en modo ${labelOf(HVAC_MODE_LABELS, String(a.data?.hvac_mode ?? '')).toLowerCase()}`;
    case 'set_preset_mode':
      return `pone ${target} en modo ${labelOf(PRESET_LABELS, String(a.data?.preset_mode ?? '')).toLowerCase()}`;
    case 'set_percentage':
      return `pone ${target} al ${num(numberData(a, 'percentage') ?? 0)} %`;
    case 'volume_set':
      return `pone el volumen de ${target} al ${Math.round((numberData(a, 'volume_level') ?? 0) * 100)} %`;
    case 'media_play':
      return `reproduce en ${target}`;
    case 'media_pause':
      return `pausa ${target}`;
    case 'media_stop':
      return `detiene ${target}`;
    case 'play_media':
      return `reproduce contenido en ${target}`;
    case 'start':
      return domain === 'vacuum' ? `pone a limpiar ${target}` : `pone en marcha ${target}`;
    case 'return_to_base':
      return `manda ${target} a la base`;
    case 'pause':
      return `pausa ${target}`;
    case 'stop':
      return `detiene ${target}`;
    default: {
      const label = serviceName(a.service);
      return `${label === a.service ? `llama a ${a.service} en` : lowerFirst(label)} ${target}`.trim();
    }
  }
}

/** «enciende X, espera N, apaga X» se cuenta como «enciende X durante N». */
function sameTargets(a: ServiceAction, b: ServiceAction): boolean {
  const ka = [...serviceEntityIds(a), ...serviceAreaIds(a)].join('|');
  return ka !== '' && ka === [...serviceEntityIds(b), ...serviceAreaIds(b)].join('|');
}

function describeSequence(actions: Action[], ctx: Ctx): string {
  const parts: string[] = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const delay = actions[i + 1];
    const off = actions[i + 2];
    if (
      a?.type === 'service' &&
      a.service.endsWith('.turn_on') &&
      delay?.type === 'delay' &&
      off?.type === 'service' &&
      off.service.endsWith('.turn_off') &&
      sameTargets(a, off)
    ) {
      parts.push(`${describeService(ctx, a)} durante ${durationText(delay.seconds)}`);
      i += 2;
      continue;
    }
    if (a) parts.push(describeAction(a, ctx));
  }
  return joinList(parts);
}

function conditionsText(cs: Condition[], ctx: Ctx): string {
  return joinList(cs.map((c) => describeConditionClause(c, ctx)));
}

function describeAction(a: Action, ctx: Ctx): string {
  switch (a.type) {
    case 'service':
      return describeService(ctx, a);
    case 'scene':
      return `activa la escena ${quoted(ctx.project.scenes.find((s) => s.id === a.sceneId)?.name ?? 'que ya no existe')}`;
    case 'script':
      return `ejecuta el script ${quoted(ctx.project.scripts.find((s) => s.id === a.scriptId)?.name ?? 'que ya no existe')}`;
    case 'delay':
      return `espera ${durationText(a.seconds)}`;
    case 'notify':
      return notifyText(a.title, a.message);
    case 'variables':
      return `guarda ${plural(Object.keys(a.variables).length, 'la variable', 'las variables')} ${joinList(Object.keys(a.variables).map(quoted))}`;
    case 'choose': {
      const options = a.choices.map((o) => `si ${conditionsText(o.conditions, ctx) || 'siempre'}, ${describeSequence(o.sequence, ctx) || 'no hace nada'}`);
      if (a.default && a.default.length > 0) options.push(`si no, ${describeSequence(a.default, ctx)}`);
      return options.join('; ');
    }
    case 'if': {
      const text = `si ${conditionsText(a.conditions, ctx) || 'siempre'}, ${describeSequence(a.then, ctx) || 'no hace nada'}`;
      return a.else && a.else.length > 0 ? `${text}; si no, ${describeSequence(a.else, ctx)}` : text;
    }
    case 'repeat': {
      const body = describeSequence(a.sequence, ctx) || 'no hace nada';
      if (a.count !== undefined) return `repite ${a.count} ${plural(a.count, 'vez', 'veces')}: ${body}`;
      if (a.while) return `mientras ${conditionsText(a.while, ctx)}, repite: ${body}`;
      if (a.until) return `repite (${body}) hasta que ${conditionsText(a.until, ctx)}`;
      return `repite: ${body}`;
    }
    case 'wait_for_trigger': {
      const what = joinList(a.triggers.map((t) => describeTriggerClause(t, ctx)), 'o');
      return `espera a que ocurra esto: ${what}${a.timeoutSeconds ? ` (como mucho ${durationText(a.timeoutSeconds)})` : ''}`;
    }
    case 'stop':
      return `se detiene${a.message ? ` (${a.message})` : ''}`;
    case 'parallel':
      return `a la vez: ${a.branches.map((b) => describeSequence(b, ctx) || 'nada').join('; ')}`;
  }
}

/**
 * Automatización en lenguaje natural: «Cuando <disparadores> y <condiciones>, <acciones>».
 * `defs` por defecto es el catálogo.
 */
export function describeAutomation(a: Automation, project: Project, defs: DeviceDefinition[] = catalog): string {
  const ctx = buildCtx(project, defs);
  const triggers = joinList(a.triggers.map((t) => describeTriggerClause(t, ctx)), 'o');
  const conditions = conditionsText(a.conditions, ctx);
  const actions = describeSequence(a.actions, ctx) || 'no hace nada';
  const when = triggers ? `Cuando ${triggers}` : 'Al ejecutarla a mano';
  return `${when}${conditions ? ` y ${conditions}` : ''}, ${actions}`;
}
