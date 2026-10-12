// Tanda 3: helpers de Home Assistant (input_boolean, input_number, input_select, input_text,
// input_datetime, timer y counter). Entidades, servicios y validación. Funciones puras.
import type { EntityState, EntityStateValue, Helper, HelperType, Project, ServiceData, ServiceDataValue } from '../types';
import { slugify } from '../devices/entities';

export const HELPER_TYPES: readonly HelperType[] = ['input_boolean', 'input_number', 'input_select', 'input_text', 'input_datetime', 'timer', 'counter'];

/** Nombre en español de cada tipo de helper. */
export const HELPER_TYPE_LABELS: Record<HelperType, string> = {
  input_boolean: 'Interruptor',
  input_number: 'Número',
  input_select: 'Desplegable',
  input_text: 'Texto',
  input_datetime: 'Fecha y hora',
  timer: 'Temporizador',
  counter: 'Contador',
};

/** Estados del helper timer. */
export const TIMER_STATE_LABELS: Record<string, string> = { idle: 'Inactivo', active: 'En marcha', paused: 'En pausa' };

/** Longitud máxima por defecto de input_text (como HA). */
export const DEFAULT_TEXT_MAX = 100;

export function isHelperDomain(domain: string): domain is HelperType {
  return HELPER_TYPES.some((t) => t === domain);
}

/** entity_id del helper: <tipo>.<slug del nombre>. */
export function helperEntityId(h: Pick<Helper, 'type' | 'name'>): string {
  return `${h.type}.${slugify(h.name)}`;
}

/** Helper del proyecto con ese entity_id. */
export function findHelperByEntity(project: Pick<Project, 'helpers'>, entityId: string): Helper | undefined {
  return project.helpers?.find((h) => helperEntityId(h) === entityId);
}

/** entity_id de todos los helpers del proyecto. */
export function helperEntityIds(project: Pick<Project, 'helpers'>): string[] {
  return (project.helpers ?? []).map(helperEntityId);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Segundos → "H:MM:SS" (formato de duration y remaining de los timer de HA). */
export function formatTimerDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** "H:MM:SS", "MM:SS" o segundos → segundos (undefined si no se entiende). */
export function parseTimerDuration(v: ServiceDataValue | undefined): number | undefined {
  if (v === undefined || typeof v === 'boolean' || Array.isArray(v)) return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  const t = v.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = /^(-)?(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
  if (!m) return undefined;
  const total = m[4] === undefined ? Number(m[2]) * 60 + Number(m[3]) : Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
  return m[1] ? -total : total;
}

function stepDecimals(step: number): number {
  const text = String(step);
  return text.includes('.') ? (text.split('.')[1]?.length ?? 0) : 0;
}

function datetimeInitial(h: Extract<Helper, { type: 'input_datetime' }>): string {
  if (h.initial !== undefined) return h.initial;
  if (h.has_date && h.has_time) return '1970-01-01 00:00:00';
  return h.has_date ? '1970-01-01' : '00:00:00';
}

/** Estado inicial de un helper (con los atributos que muestra HA). */
export function helperInitialState(h: Helper): EntityState {
  const attributes: Record<string, EntityStateValue> = { friendly_name: h.name, helper_id: h.id };
  if (h.icon !== undefined) attributes.icon = h.icon;
  switch (h.type) {
    case 'input_boolean':
      return { state: h.initial ? 'on' : 'off', attributes };
    case 'input_number': {
      const value = clampStep(h.initial ?? h.min, h);
      Object.assign(attributes, { min: h.min, max: h.max, step: h.step, mode: h.mode });
      if (h.unit !== undefined) attributes.unit_of_measurement = h.unit;
      return { state: value, attributes };
    }
    case 'input_select': {
      attributes.options = h.options.join(', ');
      const initial = h.initial !== undefined && h.options.includes(h.initial) ? h.initial : (h.options[0] ?? 'unknown');
      return { state: initial, attributes };
    }
    case 'input_text':
      attributes.max = h.max ?? DEFAULT_TEXT_MAX;
      return { state: (h.initial ?? '').slice(0, h.max ?? DEFAULT_TEXT_MAX), attributes };
    case 'input_datetime':
      Object.assign(attributes, { has_date: h.has_date, has_time: h.has_time });
      return { state: datetimeInitial(h), attributes };
    case 'timer':
      Object.assign(attributes, { duration: formatTimerDuration(h.duration), editable: true });
      return { state: 'idle', attributes };
    case 'counter': {
      Object.assign(attributes, { initial: h.initial, step: h.step, editable: true });
      if (h.minimum !== undefined) attributes.minimum = h.minimum;
      if (h.maximum !== undefined) attributes.maximum = h.maximum;
      return { state: h.initial, attributes };
    }
  }
}

/** Entidades iniciales de los helpers del proyecto. */
export function helperEntities(project: Pick<Project, 'helpers'>): Record<string, EntityState> {
  const out: Record<string, EntityState> = {};
  for (const h of project.helpers ?? []) out[helperEntityId(h)] = helperInitialState(h);
  return out;
}

function clampStep(value: number, h: { min: number; max: number; step: number }): number {
  const step = h.step > 0 ? h.step : 1;
  const snapped = h.min + Math.round((value - h.min) / step) * step;
  return Number(Math.max(h.min, Math.min(h.max, snapped)).toFixed(stepDecimals(step)));
}

function num(v: ServiceDataValue | undefined): number | undefined {
  if (v === undefined || typeof v === 'boolean' || Array.isArray(v) || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ---------- Servicios ----------

export interface HelperServiceResult {
  state: EntityState;
  warnings: string[];
  /** timer: programar el fin dentro de `seconds` o cancelarlo. */
  timer?: { start: number } | { cancel: true };
  /** Evento que se lanza en el bus (timer.finished, timer.cancelled...). */
  event?: { type: string; data: Record<string, EntityStateValue> };
}

/** Configuración de un helper a partir de los atributos de su entidad (si no está en el proyecto). */
function numberConfig(st: EntityState): { min: number; max: number; step: number } {
  const a = st.attributes ?? {};
  return { min: num(a.min as ServiceDataValue) ?? 0, max: num(a.max as ServiceDataValue) ?? 100, step: num(a.step as ServiceDataValue) ?? 1 };
}

function optionsOf(st: EntityState, helper?: Helper): string[] {
  if (helper?.type === 'input_select') return helper.options;
  const raw = st.attributes?.options;
  return typeof raw === 'string' && raw !== '' ? raw.split(',').map((x) => x.trim()) : [];
}

function done(current: EntityState, state: EntityStateValue, attrs: Record<string, EntityStateValue>, warnings: string[] = []): HelperServiceResult {
  const next: EntityState = { state, attributes: attrs };
  if (current.lastChanged !== undefined) next.lastChanged = current.lastChanged;
  return { state: next, warnings };
}

const isoAt = (ms: number): string => new Date(ms).toISOString();

function timerService(entityId: string, service: string, current: EntityState, data: ServiceData, now: number, helper?: Helper): HelperServiceResult | undefined {
  const attrs: Record<string, EntityStateValue> = { ...current.attributes };
  const configured = helper?.type === 'timer' ? helper.duration : parseTimerDuration(attrs.duration) ?? 0;
  const remainingNow = (): number => {
    if (current.state === 'active' && typeof attrs.finishes_at === 'string') return Math.max(0, (Date.parse(attrs.finishes_at) - now) / 1000);
    return parseTimerDuration(attrs.remaining) ?? configured;
  };
  const event = (type: string): HelperServiceResult['event'] => ({ type, data: { entity_id: entityId } });
  const idle = (): Record<string, EntityStateValue> => {
    const a = { ...attrs };
    delete a.remaining;
    delete a.finishes_at;
    a.duration = formatTimerDuration(configured);
    return a;
  };
  switch (service) {
    case 'start': {
      const requested = parseTimerDuration(data.duration);
      if (data.duration !== undefined && requested === undefined) return done(current, current.state, attrs, [`Duración no válida: ${String(data.duration)}`]);
      const seconds = requested ?? (current.state === 'paused' ? remainingNow() : configured);
      if (!(seconds > 0)) return done(current, current.state, attrs, ['El temporizador necesita una duración mayor que 0']);
      const a = { ...attrs, duration: formatTimerDuration(requested ?? configured), remaining: formatTimerDuration(seconds), finishes_at: isoAt(now + seconds * 1000) };
      return { ...done(current, 'active', a), timer: { start: seconds }, event: event(current.state === 'paused' ? 'timer.restarted' : 'timer.started') };
    }
    case 'pause': {
      if (current.state !== 'active') return done(current, current.state, attrs, ['El temporizador no está en marcha']);
      const a: Record<string, EntityStateValue> = { ...attrs, remaining: formatTimerDuration(remainingNow()) };
      delete a.finishes_at;
      return { ...done(current, 'paused', a), timer: { cancel: true }, event: event('timer.paused') };
    }
    case 'cancel':
      return { ...done(current, 'idle', idle()), timer: { cancel: true }, event: current.state === 'idle' ? undefined : event('timer.cancelled') };
    case 'finish':
      if (current.state === 'idle') return done(current, 'idle', idle(), ['El temporizador no está en marcha']);
      return { ...done(current, 'idle', idle()), timer: { cancel: true }, event: event('timer.finished') };
    case 'change': {
      const delta = parseTimerDuration(data.duration);
      if (delta === undefined) return done(current, current.state, attrs, ['Falta "duration" en timer.change']);
      if (current.state === 'idle') return done(current, 'idle', attrs, ['El temporizador no está en marcha']);
      const seconds = Math.max(0, remainingNow() + delta);
      const a: Record<string, EntityStateValue> = { ...attrs, remaining: formatTimerDuration(seconds) };
      if (current.state === 'active') {
        a.finishes_at = isoAt(now + seconds * 1000);
        return { ...done(current, 'active', a), timer: { start: seconds } };
      }
      return done(current, 'paused', a);
    }
    default:
      return undefined;
  }
}

/** Fin natural de un timer: estado idle (el motor lanza timer.finished). */
export function timerFinishedState(current: EntityState, helper?: Helper): EntityState {
  const attrs: Record<string, EntityStateValue> = { ...current.attributes };
  delete attrs.remaining;
  delete attrs.finishes_at;
  if (helper?.type === 'timer') attrs.duration = formatTimerDuration(helper.duration);
  const next: EntityState = { state: 'idle', attributes: attrs };
  if (current.lastChanged !== undefined) next.lastChanged = current.lastChanged;
  return next;
}

/**
 * Resultado de un servicio sobre un helper, o undefined si el servicio no existe en su dominio.
 * `helper` (opcional) da la configuración; si falta se usan los atributos de la entidad.
 */
export function applyHelperService(
  domain: HelperType,
  entityId: string,
  service: string,
  current: EntityState,
  data: ServiceData = {},
  now = 0,
  helper?: Helper,
): HelperServiceResult | undefined {
  const attrs: Record<string, EntityStateValue> = { ...current.attributes };
  switch (domain) {
    case 'input_boolean':
      if (service === 'turn_on') return done(current, 'on', attrs);
      if (service === 'turn_off') return done(current, 'off', attrs);
      if (service === 'toggle') return done(current, current.state === 'on' ? 'off' : 'on', attrs);
      return undefined;
    case 'input_number': {
      const cfg = helper?.type === 'input_number' ? helper : numberConfig(current);
      const value = num(current.state as ServiceDataValue) ?? cfg.min;
      if (service === 'set_value') {
        const v = num(data.value);
        if (v === undefined) return done(current, current.state, attrs, ['Falta "value" en input_number.set_value']);
        if (v < cfg.min || v > cfg.max) return done(current, current.state, attrs, [`Valor ${v} fuera del rango ${cfg.min}-${cfg.max}`]);
        return done(current, clampStep(v, cfg), attrs);
      }
      if (service === 'increment') return done(current, clampStep(Math.min(cfg.max, value + cfg.step), cfg), attrs);
      if (service === 'decrement') return done(current, clampStep(Math.max(cfg.min, value - cfg.step), cfg), attrs);
      return undefined;
    }
    case 'input_select': {
      const options = optionsOf(current, helper);
      const index = options.indexOf(String(current.state));
      const cycle = data.cycle !== false && data.cycle !== 'false';
      switch (service) {
        case 'select_option': {
          const option = data.option === undefined ? undefined : String(data.option);
          if (option === undefined) return done(current, current.state, attrs, ['Falta "option" en input_select.select_option']);
          if (!options.includes(option)) return done(current, current.state, attrs, [`Opción no válida: ${option} (hay ${options.join(', ')})`]);
          return done(current, option, attrs);
        }
        case 'select_next':
        case 'select_previous': {
          if (options.length === 0) return done(current, current.state, attrs, ['El desplegable no tiene opciones']);
          const delta = service === 'select_next' ? 1 : -1;
          let next = index + delta;
          if (next >= options.length) next = cycle ? 0 : options.length - 1;
          if (next < 0) next = cycle ? options.length - 1 : 0;
          return done(current, options[next] ?? current.state, attrs);
        }
        case 'select_first':
          return done(current, options[0] ?? current.state, attrs);
        case 'select_last':
          return done(current, options[options.length - 1] ?? current.state, attrs);
        default:
          return undefined;
      }
    }
    case 'input_text': {
      if (service !== 'set_value') return undefined;
      if (data.value === undefined) return done(current, current.state, attrs, ['Falta "value" en input_text.set_value']);
      const max = helper?.type === 'input_text' ? (helper.max ?? DEFAULT_TEXT_MAX) : (num(attrs.max as ServiceDataValue) ?? DEFAULT_TEXT_MAX);
      const text = Array.isArray(data.value) ? data.value.join(', ') : String(data.value);
      if (text.length > max) return done(current, current.state, attrs, [`El texto supera los ${max} caracteres`]);
      return done(current, text, attrs);
    }
    case 'input_datetime': {
      if (service !== 'set_datetime') return undefined;
      const hasDate = helper?.type === 'input_datetime' ? helper.has_date : attrs.has_date !== false;
      const hasTime = helper?.type === 'input_datetime' ? helper.has_time : attrs.has_time !== false;
      const [curDate = '1970-01-01', curTime = '00:00:00'] = String(current.state).includes(' ')
        ? String(current.state).split(' ')
        : hasDate
          ? [String(current.state), '00:00:00']
          : ['1970-01-01', String(current.state)];
      let date = curDate;
      let time = curTime;
      if (typeof data.datetime === 'string') [date = curDate, time = curTime] = data.datetime.replace('T', ' ').split(' ');
      if (typeof data.date === 'string') date = data.date;
      if (typeof data.time === 'string') time = data.time.length === 5 ? `${data.time}:00` : data.time;
      const ts = num(data.timestamp);
      if (ts !== undefined) [date = curDate, time = curTime] = new Date(ts * 1000).toISOString().slice(0, 19).split('T');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) return done(current, current.state, attrs, ['Fecha u hora no válida']);
      const state = hasDate && hasTime ? `${date} ${time}` : hasDate ? date : time;
      return done(current, state, attrs);
    }
    case 'timer':
      return timerService(entityId, service, current, data, now, helper);
    case 'counter': {
      const cfg = helper?.type === 'counter' ? helper : { initial: num(attrs.initial as ServiceDataValue) ?? 0, step: num(attrs.step as ServiceDataValue) ?? 1, minimum: num(attrs.minimum as ServiceDataValue), maximum: num(attrs.maximum as ServiceDataValue) };
      const value = num(current.state as ServiceDataValue) ?? cfg.initial;
      const within = (v: number): boolean => (cfg.minimum === undefined || v >= cfg.minimum) && (cfg.maximum === undefined || v <= cfg.maximum);
      const to = (v: number): HelperServiceResult => (within(v) ? done(current, v, attrs) : done(current, current.state, attrs, [`El contador no puede pasar a ${v} (límites ${cfg.minimum ?? '−∞'} a ${cfg.maximum ?? '∞'})`]));
      switch (service) {
        case 'increment':
          return to(value + cfg.step);
        case 'decrement':
          return to(value - cfg.step);
        case 'reset':
          return done(current, cfg.initial, attrs);
        case 'set_value': {
          const v = num(data.value);
          return v === undefined ? done(current, current.state, attrs, ['Falta "value" en counter.set_value']) : to(v);
        }
        default:
          return undefined;
      }
    }
  }
}

// ---------- Validación ----------

/** Problemas de configuración de un helper (en español; vacío si es correcto). */
export function validateHelper(h: Helper): string[] {
  const errors: string[] = [];
  if (h.name.trim() === '') errors.push('El helper necesita un nombre');
  switch (h.type) {
    case 'input_number':
      if (!(h.min < h.max)) errors.push('El mínimo debe ser menor que el máximo');
      if (!(h.step > 0)) errors.push('El paso debe ser mayor que 0');
      if (h.initial !== undefined && (h.initial < h.min || h.initial > h.max)) errors.push('El valor inicial está fuera del rango');
      break;
    case 'input_select':
      if (h.options.length === 0) errors.push('El desplegable necesita al menos una opción');
      if (new Set(h.options).size !== h.options.length) errors.push('Hay opciones repetidas');
      if (h.initial !== undefined && !h.options.includes(h.initial)) errors.push(`La opción inicial «${h.initial}» no está en la lista`);
      break;
    case 'input_text':
      if (h.max !== undefined && !(h.max > 0 && h.max <= 255)) errors.push('La longitud máxima debe estar entre 1 y 255');
      break;
    case 'input_datetime':
      if (!h.has_date && !h.has_time) errors.push('Debe tener fecha, hora o ambas');
      break;
    case 'timer':
      if (!(h.duration > 0)) errors.push('La duración debe ser mayor que 0');
      break;
    case 'counter':
      if (!(h.step > 0)) errors.push('El paso debe ser mayor que 0');
      if (h.minimum !== undefined && h.maximum !== undefined && h.minimum > h.maximum) errors.push('El mínimo no puede ser mayor que el máximo');
      if ((h.minimum !== undefined && h.initial < h.minimum) || (h.maximum !== undefined && h.initial > h.maximum)) errors.push('El valor inicial está fuera de los límites');
      break;
    case 'input_boolean':
      break;
  }
  return errors;
}

/** entity_id antiguo -> nuevo al renombrar un helper (vacío si no cambia). */
export function renameHelperMapping(project: Pick<Project, 'helpers'>, helperId: string, newName: string): Record<string, string> {
  const h = project.helpers?.find((x) => x.id === helperId);
  if (!h) return {};
  const from = helperEntityId(h);
  const to = helperEntityId({ ...h, name: newName });
  return from === to ? {} : { [from]: to };
}

// ---------- Exportación (configuración YAML de HA) ----------

/** Configuración de HA de un helper (lo que va bajo `input_boolean: <clave>:`...). */
export function helperConfig(h: Helper): Record<string, EntityStateValue | string[]> {
  const m: Record<string, EntityStateValue | string[]> = { name: h.name };
  if (h.icon !== undefined) m.icon = h.icon;
  switch (h.type) {
    case 'input_boolean':
      if (h.initial !== undefined) m.initial = h.initial;
      break;
    case 'input_number':
      Object.assign(m, { min: h.min, max: h.max, step: h.step, mode: h.mode });
      if (h.unit !== undefined) m.unit_of_measurement = h.unit;
      if (h.initial !== undefined) m.initial = h.initial;
      break;
    case 'input_select':
      m.options = [...h.options];
      if (h.initial !== undefined) m.initial = h.initial;
      break;
    case 'input_text':
      if (h.max !== undefined) m.max = h.max;
      if (h.initial !== undefined) m.initial = h.initial;
      break;
    case 'input_datetime':
      m.has_date = h.has_date;
      m.has_time = h.has_time;
      if (h.initial !== undefined) m.initial = h.initial;
      break;
    case 'timer':
      m.duration = formatTimerDuration(h.duration);
      break;
    case 'counter':
      Object.assign(m, { initial: h.initial, step: h.step });
      if (h.minimum !== undefined) m.minimum = h.minimum;
      if (h.maximum !== undefined) m.maximum = h.maximum;
      break;
  }
  return m;
}

/** Helpers agrupados por dominio y por clave (objeto del entity_id), para el YAML de HA. */
export function helpersByDomain(helpers: readonly Helper[]): Map<HelperType, Record<string, Record<string, EntityStateValue | string[]>>> {
  const out = new Map<HelperType, Record<string, Record<string, EntityStateValue | string[]>>>();
  for (const h of helpers) {
    const key = helperEntityId(h).split('.')[1] ?? slugify(h.name);
    const domain = out.get(h.type) ?? {};
    domain[key] = helperConfig(h);
    out.set(h.type, domain);
  }
  return out;
}
