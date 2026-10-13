// Efecto de los servicios de Home Assistant sobre una entidad (funciones puras).
//
// applyService devuelve el estado COMPLETO resultante (los atributos se reemplazan, para poder
// quitar p. ej. el brillo al apagar), avisos para el registro y peticiones de temporizador que
// el motor programa (recorrido de persianas, vuelta a la base de la aspiradora).
import type { EntityCapabilities, EntityState, EntityStateValue, ServiceData, ServiceDataValue } from '../types';
import { formatRgb, parseRgb } from '../devices/color';
import { hvacAction } from '../devices/climate';
import { isDimmable, withDefaults } from '../devices/capabilities';
import { vacuumService as robotService, type VacuumContext } from './vacuum';
import { assistSatelliteService } from './voice';

type Attrs = Record<string, EntityStateValue>;

export interface ServiceContext {
  now: number;
  /** Capacidades efectivas de la entidad (sin ellas, las por defecto del dominio). */
  capabilities?: EntityCapabilities;
  /** Tanda 3: código de la alarma (alarm_control_panel). */
  code?: string;
  /** Robot aspirador: salas del mapa, batería y modo de la mopa. */
  vacuum?: VacuumContext;
}

export interface ServiceResult {
  /** Estado completo tras el servicio. */
  state: EntityState;
  /** Avisos (datos ignorados o fuera de rango) para el registro. */
  warnings: string[];
  /** Persiana: iniciar recorrido hacia esta posición (0-100). */
  coverTarget?: number;
  /** Cambio diferido (p. ej. el satélite de voz vuelve a reposo): se aplica a los `seconds`. */
  after?: { seconds: number; state: EntityState };
  /** Segundo cambio diferido (el satélite que escucha la respuesta vuelve a reposo). */
  then?: { seconds: number; state: EntityState };
  /** Robot aspirador: segundos hasta su próximo paso (null: ninguno pendiente). */
  vacuumNext?: number | null;
  /** Aviso informativo para el registro (p. ej. el robot pita al localizarlo). */
  notice?: string;
}

export { VACUUM_RETURN_SECONDS } from './vacuum';
/** Paso de volumen de volume_up / volume_down. */
export const VOLUME_STEP = 0.1;
/** Paso máximo (en puntos de posición) de cada temporizador del recorrido de una persiana. */
export const COVER_STEP = 10;

// ---------- Utilidades ----------

function num(v: ServiceDataValue | undefined): number | undefined {
  if (v === undefined || typeof v === 'boolean' || Array.isArray(v) || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: ServiceDataValue | undefined): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 'on') return true;
  if (v === 'false' || v === 'off') return false;
  return undefined;
}

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));
const round = (n: number, decimals = 0): number => Number(n.toFixed(decimals));

function result(current: EntityState, state: EntityStateValue, attrs: Attrs, warnings: string[] = []): ServiceResult {
  const next: EntityState = { state, attributes: attrs };
  if (current.lastChanged !== undefined) next.lastChanged = current.lastChanged;
  return { state: next, warnings };
}

function attrsOf(current: EntityState): Attrs {
  return { ...current.attributes };
}

function without(attrs: Attrs, ...keys: string[]): Attrs {
  const copy = { ...attrs };
  for (const k of keys) delete copy[k];
  return copy;
}

export function isOffState(state: EntityStateValue): boolean {
  return state === 'off' || state === false;
}

/** Brillo 0-255 a porcentaje 0-100 (redondeado). */
export function brightnessToPct(brightness: number): number {
  return Math.round((clamp(brightness, 0, 255) / 255) * 100);
}

/** Porcentaje 0-100 a brillo 0-255 (redondeado). */
export function pctToBrightness(pct: number): number {
  return Math.round((clamp(pct, 0, 100) / 100) * 255);
}

// ---------- light ----------

function colorModeOf(attrs: Attrs, caps: EntityCapabilities): string {
  const modes = caps.colorModes ?? [];
  if (attrs.rgb_color !== undefined && modes.includes('rgb')) return 'rgb';
  if (attrs.color_temp_kelvin !== undefined && modes.includes('color_temp')) return 'color_temp';
  return isDimmable(caps) ? 'brightness' : 'onoff';
}

function requestedBrightness(current: EntityState, data: ServiceData, warnings: string[]): number | undefined {
  const on = current.state === 'on';
  const now = num(current.attributes?.brightness) ?? 0;
  const brightness = num(data.brightness);
  if (brightness !== undefined) return clamp(Math.round(brightness), 0, 255);
  const pct = num(data.brightness_pct);
  if (pct !== undefined) return pctToBrightness(pct);
  const step = num(data.brightness_step_pct);
  if (step !== undefined) return pctToBrightness(brightnessToPct(on ? now : 0) + step);
  const step255 = num(data.brightness_step);
  if (step255 !== undefined) return clamp((on ? now : 0) + Math.round(step255), 0, 255);
  for (const k of ['brightness', 'brightness_pct', 'brightness_step_pct', 'brightness_step']) {
    if (data[k] !== undefined) warnings.push(`Valor de ${k} no válido: ${String(data[k])}`);
  }
  return undefined;
}

function lightTurnOff(current: EntityState): ServiceResult {
  const attrs = attrsOf(current);
  const last = num(attrs.brightness);
  const next = without(attrs, 'brightness', 'color_mode');
  if (last !== undefined && last > 0) next.last_brightness = last;
  return result(current, 'off', next);
}

function lightTurnOn(current: EntityState, data: ServiceData, caps: EntityCapabilities): ServiceResult {
  const warnings: string[] = [];
  const modes = caps.colorModes ?? [];
  const dimmable = isDimmable(caps);
  let attrs = attrsOf(current);
  const requested = requestedBrightness(current, data, warnings);
  if (requested !== undefined && requested <= 0) return lightTurnOff(current);
  if (requested !== undefined && !dimmable) warnings.push('La luz no admite regulación de brillo: se ignora el brillo');

  const kelvin = num(data.color_temp_kelvin ?? data.kelvin);
  if (kelvin !== undefined) {
    if (modes.includes('color_temp')) {
      const min = caps.minKelvin ?? 2000;
      const max = caps.maxKelvin ?? 6500;
      const k = clamp(Math.round(kelvin), min, max);
      if (k !== Math.round(kelvin)) warnings.push(`Temperatura de color ajustada a ${k} K (rango ${min}-${max} K)`);
      attrs = without(attrs, 'rgb_color');
      attrs.color_temp_kelvin = k;
    } else {
      warnings.push('La luz no admite temperatura de color: se ignora color_temp_kelvin');
    }
  }
  if (data.rgb_color !== undefined) {
    const rgb = parseRgb(data.rgb_color);
    if (!rgb) warnings.push(`Color rgb_color no válido: ${String(data.rgb_color)}`);
    else if (modes.includes('rgb')) {
      attrs = without(attrs, 'color_temp_kelvin');
      attrs.rgb_color = formatRgb(rgb);
    } else warnings.push('La luz no admite color RGB: se ignora rgb_color');
  }

  if (dimmable) {
    const fallback = current.state === 'on' ? num(attrs.brightness) : num(attrs.last_brightness);
    const brightness = requested ?? fallback ?? 255;
    attrs.brightness = brightness;
    attrs.last_brightness = brightness;
  } else {
    attrs = without(attrs, 'brightness', 'last_brightness');
  }
  attrs.color_mode = colorModeOf(attrs, caps);
  return result(current, 'on', attrs, warnings);
}

function lightService(service: string, current: EntityState, data: ServiceData, caps: EntityCapabilities): ServiceResult | undefined {
  switch (service) {
    case 'turn_on':
      return lightTurnOn(current, data, caps);
    case 'turn_off':
      return lightTurnOff(current);
    case 'toggle':
      return current.state === 'on' ? lightTurnOff(current) : lightTurnOn(current, data, caps);
    default:
      return undefined;
  }
}

// ---------- switch / fan ----------

function switchService(service: string, current: EntityState): ServiceResult | undefined {
  if (service === 'turn_on') return result(current, 'on', attrsOf(current));
  if (service === 'turn_off') return result(current, 'off', attrsOf(current));
  if (service === 'toggle') return result(current, current.state === 'on' ? 'off' : 'on', attrsOf(current));
  return undefined;
}

function fanService(service: string, current: EntityState, data: ServiceData): ServiceResult | undefined {
  const attrs = attrsOf(current);
  const pct = num(data.percentage);
  const turnOn = (): ServiceResult => {
    const p = clamp(Math.round(pct ?? num(attrs.last_percentage) ?? 100), 0, 100);
    if (p === 0) return result(current, 'off', { ...attrs, percentage: 0 });
    return result(current, 'on', { ...attrs, percentage: p, last_percentage: p });
  };
  switch (service) {
    case 'turn_on':
      return turnOn();
    case 'set_percentage':
      if (pct === undefined) return result(current, current.state, attrs, ['Falta "percentage" en fan.set_percentage']);
      return turnOn();
    case 'turn_off':
      return result(current, 'off', { ...attrs, percentage: 0 });
    case 'toggle':
      return current.state === 'on' ? result(current, 'off', { ...attrs, percentage: 0 }) : turnOn();
    default:
      return undefined;
  }
}

// ---------- cover ----------

export function coverPosition(current: EntityState): number {
  const pos = num(current.attributes?.current_position);
  if (pos !== undefined) return clamp(pos, 0, 100);
  return current.state === 'closed' ? 0 : 100;
}

/** Estado en reposo de una persiana según su posición. */
export function restingCoverState(position: number): 'open' | 'closed' {
  return position > 0 ? 'open' : 'closed';
}

function coverMove(current: EntityState, target: number, caps: EntityCapabilities): ServiceResult {
  const attrs = attrsOf(current);
  const pos = coverPosition(current);
  const goal = clamp(Math.round(target), 0, 100);
  if (goal === pos) return result(current, restingCoverState(pos), { ...attrs, current_position: pos });
  if ((caps.travelSeconds ?? 0) <= 0) return result(current, restingCoverState(goal), { ...attrs, current_position: goal });
  const res = result(current, goal > pos ? 'opening' : 'closing', { ...attrs, current_position: pos });
  return { ...res, coverTarget: goal };
}

/** Segundos que tarda un paso del recorrido de `from` a `to`. */
export function coverStepSeconds(from: number, to: number, caps: EntityCapabilities): number {
  const delta = Math.min(COVER_STEP, Math.abs(to - from));
  return ((caps.travelSeconds ?? 0) * delta) / 100;
}

/** Avanza un paso el recorrido de una persiana hacia `target`. */
export function coverStep(current: EntityState, target: number): { state: EntityState; done: boolean } {
  const pos = coverPosition(current);
  const delta = clamp(target - pos, -COVER_STEP, COVER_STEP);
  const next = pos + delta;
  const done = next === target;
  const state: EntityState = {
    state: done ? restingCoverState(next) : next > pos ? 'opening' : 'closing',
    attributes: { ...current.attributes, current_position: next },
  };
  if (current.lastChanged !== undefined) state.lastChanged = current.lastChanged;
  return { state, done };
}

function coverService(service: string, current: EntityState, data: ServiceData, caps: EntityCapabilities): ServiceResult | undefined {
  const moving = current.state === 'opening' || current.state === 'closing';
  switch (service) {
    case 'open_cover':
    case 'open':
      return coverMove(current, 100, caps);
    case 'close_cover':
    case 'close':
      return coverMove(current, 0, caps);
    case 'stop_cover': {
      const pos = coverPosition(current);
      return result(current, restingCoverState(pos), { ...attrsOf(current), current_position: pos });
    }
    case 'toggle':
      if (moving) return coverService('stop_cover', current, data, caps);
      return coverMove(current, coverPosition(current) > 0 ? 0 : 100, caps);
    case 'set_cover_position': {
      const pos = num(data.position);
      if (pos === undefined) return result(current, current.state, attrsOf(current), ['Falta "position" en cover.set_cover_position']);
      return coverMove(current, pos, caps);
    }
    default:
      return undefined;
  }
}

// ---------- lock ----------

function lockService(service: string, current: EntityState): ServiceResult | undefined {
  if (service === 'lock') return result(current, 'locked', attrsOf(current));
  if (service === 'unlock') return result(current, 'unlocked', attrsOf(current));
  if (service === 'open') return result(current, 'open', attrsOf(current));
  return undefined;
}

// ---------- climate ----------

function withHvacAction(attrs: Attrs, mode: EntityStateValue): Attrs {
  return { ...attrs, hvac_action: hvacAction(String(mode), num(attrs.current_temperature), num(attrs.temperature)) };
}

function climateResult(current: EntityState, mode: EntityStateValue, attrs: Attrs, warnings: string[] = []): ServiceResult {
  const next = { ...attrs };
  if (mode !== 'off' && current.state !== mode) next.last_hvac_mode = String(mode);
  if (mode === 'off' && current.state !== 'off') next.last_hvac_mode = String(current.state);
  return result(current, mode, withHvacAction(next, mode), warnings);
}

function validMode(mode: ServiceDataValue | undefined, caps: EntityCapabilities, warnings: string[]): string | undefined {
  if (mode === undefined) return undefined;
  const m = String(mode);
  const allowed = caps.hvacModes ?? [];
  if (allowed.includes(m)) return m;
  warnings.push(`Modo HVAC no admitido: ${m} (admite ${allowed.join(', ')})`);
  return undefined;
}

/** Modo al encender: el último usado o el primero distinto de off. */
function onMode(current: EntityState, caps: EntityCapabilities): string {
  const last = current.attributes?.last_hvac_mode;
  const allowed = caps.hvacModes ?? [];
  if (typeof last === 'string' && allowed.includes(last) && last !== 'off') return last;
  return allowed.find((m) => m !== 'off') ?? 'heat';
}

/** Recalcula hvac_action con una nueva temperatura actual (sensor del mismo dispositivo). */
export function updateClimateCurrentTemperature(current: EntityState, celsius: number): EntityState {
  const attrs = withHvacAction({ ...current.attributes, current_temperature: celsius }, current.state);
  const next: EntityState = { state: current.state, attributes: attrs };
  if (current.lastChanged !== undefined) next.lastChanged = current.lastChanged;
  return next;
}

function climateService(service: string, current: EntityState, data: ServiceData, caps: EntityCapabilities): ServiceResult | undefined {
  const warnings: string[] = [];
  const attrs = attrsOf(current);
  switch (service) {
    case 'set_temperature': {
      const mode = validMode(data.hvac_mode, caps, warnings) ?? current.state;
      const t = num(data.temperature);
      if (t === undefined) {
        if (data.hvac_mode === undefined) warnings.push('Falta "temperature" en climate.set_temperature');
      } else {
        const min = caps.minTemp ?? 7;
        const max = caps.maxTemp ?? 35;
        const step = caps.tempStep ?? 0.5;
        const value = round(clamp(Math.round(t / step) * step, min, max), 2);
        if (value !== t) warnings.push(`Consigna ajustada a ${value} °C (rango ${min}-${max} °C, paso ${step})`);
        attrs.temperature = value;
      }
      return climateResult(current, mode, attrs, warnings);
    }
    case 'set_hvac_mode': {
      const mode = validMode(data.hvac_mode, caps, warnings);
      if (data.hvac_mode === undefined) warnings.push('Falta "hvac_mode" en climate.set_hvac_mode');
      return climateResult(current, mode ?? current.state, attrs, warnings);
    }
    case 'set_preset_mode': {
      const preset = data.preset_mode === undefined ? undefined : String(data.preset_mode);
      const allowed = caps.presetModes ?? [];
      if (preset !== undefined && allowed.includes(preset)) attrs.preset_mode = preset;
      else warnings.push(preset === undefined ? 'Falta "preset_mode"' : `Preset no admitido: ${preset} (admite ${allowed.join(', ') || 'ninguno'})`);
      return climateResult(current, current.state, attrs, warnings);
    }
    case 'set_fan_mode': {
      const fan = data.fan_mode === undefined ? undefined : String(data.fan_mode);
      const allowed = caps.fanModes ?? [];
      if (fan !== undefined && allowed.includes(fan)) attrs.fan_mode = fan;
      else warnings.push(fan === undefined ? 'Falta "fan_mode"' : `Modo de ventilador no admitido: ${fan} (admite ${allowed.join(', ') || 'ninguno'})`);
      return climateResult(current, current.state, attrs, warnings);
    }
    case 'turn_on':
      return climateResult(current, current.state === 'off' ? onMode(current, caps) : current.state, attrs);
    case 'turn_off':
      return climateResult(current, 'off', attrs);
    case 'toggle':
      return climateResult(current, current.state === 'off' ? onMode(current, caps) : 'off', attrs);
    default:
      return undefined;
  }
}

// ---------- media_player ----------

function volumeResult(current: EntityState, volume: number): ServiceResult {
  return result(current, current.state, { ...attrsOf(current), volume_level: round(clamp(volume, 0, 1), 2), is_volume_muted: false });
}

function mediaService(service: string, current: EntityState, data: ServiceData, caps: EntityCapabilities): ServiceResult | undefined {
  const attrs = attrsOf(current);
  const volume = num(attrs.volume_level) ?? 0;
  switch (service) {
    case 'turn_on':
      return result(current, current.state === 'off' ? 'on' : current.state, attrs);
    case 'turn_off':
      return result(current, 'off', attrs);
    case 'toggle':
      return result(current, current.state === 'off' ? 'on' : 'off', attrs);
    case 'media_play':
      return result(current, 'playing', attrs);
    case 'media_pause':
      return result(current, 'paused', attrs);
    case 'media_stop':
      return result(current, 'idle', attrs);
    case 'media_play_pause':
      return result(current, current.state === 'playing' ? 'paused' : 'playing', attrs);
    case 'media_next_track':
    case 'media_previous_track':
      return result(current, current.state, attrs);
    case 'play_media': {
      const extra: Attrs = {};
      for (const [k, v] of Object.entries(data)) if (!Array.isArray(v)) extra[k] = v;
      return result(current, 'playing', { ...attrs, ...extra });
    }
    case 'volume_set': {
      const v = num(data.volume_level);
      if (v === undefined) return result(current, current.state, attrs, ['Falta "volume_level" en media_player.volume_set']);
      return volumeResult(current, v);
    }
    case 'volume_up':
      return volumeResult(current, volume + VOLUME_STEP);
    case 'volume_down':
      return volumeResult(current, volume - VOLUME_STEP);
    case 'volume_mute': {
      const muted = bool(data.is_volume_muted) ?? attrs.is_volume_muted !== true;
      return result(current, current.state, { ...attrs, is_volume_muted: muted });
    }
    case 'select_source': {
      const source = data.source === undefined ? undefined : String(data.source);
      const sources = caps.sources ?? [];
      if (source === undefined) return result(current, current.state, attrs, ['Falta "source" en media_player.select_source']);
      if (sources.length > 0 && !sources.includes(source)) {
        return result(current, current.state, attrs, [`Fuente no disponible: ${source} (hay ${sources.join(', ')})`]);
      }
      return result(current, current.state === 'off' ? 'on' : current.state, { ...attrs, source });
    }
    default:
      return undefined;
  }
}

// ---------- vacuum ----------

function vacuumService(service: string, current: EntityState, data: ServiceData, caps: EntityCapabilities, ctx?: VacuumContext): ServiceResult | undefined {
  const r = robotService(service, current, data, caps, ctx);
  if (!r) return undefined;
  const res: ServiceResult = { state: r.state, warnings: r.warnings, vacuumNext: r.next ?? null };
  if (r.notice !== undefined) res.notice = r.notice;
  return res;
}

// ---------- camera / button ----------

function cameraService(service: string, current: EntityState): ServiceResult | undefined {
  if (service === 'turn_on') return result(current, current.state === 'off' ? 'idle' : current.state, attrsOf(current));
  if (service === 'turn_off') return result(current, 'off', attrsOf(current));
  if (service === 'snapshot') return result(current, current.state, attrsOf(current));
  if (service === 'record') return result(current, 'recording', attrsOf(current));
  return undefined;
}

// ---------- Tanda 3: alarm_control_panel / valve ----------

/** Código por defecto de la alarma simulada si el dispositivo no tiene uno. */
export const DEFAULT_ALARM_CODE = '1234';
/** Modos de armado por defecto. */
export const DEFAULT_ALARM_MODES = ['armed_home', 'armed_away', 'armed_night'];

const ARM_SERVICES: Record<string, string> = {
  alarm_arm_home: 'armed_home',
  alarm_arm_away: 'armed_away',
  alarm_arm_night: 'armed_night',
  alarm_arm_vacation: 'armed_vacation',
  alarm_arm_custom_bypass: 'armed_custom_bypass',
};

function alarmService(service: string, current: EntityState, data: ServiceData, caps: EntityCapabilities, code: string): ServiceResult | undefined {
  const attrs = attrsOf(current);
  const given = data.code === undefined ? undefined : String(data.code);
  const codeOk = given === code;
  const target = ARM_SERVICES[service];
  if (target !== undefined) {
    const modes = caps.alarmModes ?? DEFAULT_ALARM_MODES;
    if (!modes.includes(target)) return result(current, current.state, attrs, [`Modo de armado no admitido: ${target} (admite ${modes.join(', ')})`]);
    if (caps.codeArmRequired && !codeOk) return result(current, current.state, attrs, [given === undefined ? 'Falta el código para armar la alarma' : 'Código incorrecto: la alarma no se arma']);
    return result(current, target, { ...attrs, changed_by: 'Home Assistant' });
  }
  if (service === 'alarm_disarm') {
    if (!codeOk) return result(current, current.state, attrs, [given === undefined ? 'Falta el código para desarmar la alarma' : 'Código incorrecto: la alarma sigue armada']);
    const next = without(attrs, 'previous_state');
    return result(current, 'disarmed', { ...next, changed_by: 'Home Assistant' });
  }
  if (service === 'alarm_trigger') {
    if (current.state === 'triggered') return result(current, 'triggered', attrs);
    return result(current, 'triggered', { ...attrs, previous_state: String(current.state) });
  }
  return undefined;
}

function valveService(service: string, current: EntityState): ServiceResult | undefined {
  const attrs = attrsOf(current);
  switch (service) {
    case 'open_valve':
    case 'open':
      return result(current, 'open', attrs);
    case 'close_valve':
    case 'close':
      return result(current, 'closed', attrs);
    case 'stop_valve':
      return result(current, current.state === 'opening' ? 'open' : current.state === 'closing' ? 'closed' : current.state, attrs);
    case 'toggle':
      return result(current, current.state === 'closed' ? 'open' : 'closed', attrs);
    default:
      return undefined;
  }
}

/** Equivalencia de homeassistant.turn_on/turn_off/toggle en dominios sin esos servicios. */
const GENERIC: Record<string, Record<string, string>> = {
  cover: { turn_on: 'open_cover', turn_off: 'close_cover' },
  lock: { turn_on: 'lock', turn_off: 'unlock' },
  vacuum: { turn_on: 'start', turn_off: 'return_to_base', toggle: 'start_pause' },
  valve: { turn_on: 'open_valve', turn_off: 'close_valve' },
};

/**
 * Resultado de llamar a `domain.service` sobre una entidad del dominio `entityDomain`,
 * o undefined si el servicio no está soportado. `service` es el nombre sin dominio.
 */
export function applyService(
  entityDomain: string,
  service: string,
  current: EntityState,
  data: ServiceData = {},
  ctx: ServiceContext = { now: 0 },
): ServiceResult | undefined {
  const caps = withDefaults(entityDomain, ctx.capabilities);
  const svc = GENERIC[entityDomain]?.[service] ?? service;
  switch (entityDomain) {
    case 'light':
      return lightService(svc, current, data, caps);
    case 'switch':
      return switchService(svc, current);
    case 'fan':
      return fanService(svc, current, data);
    case 'cover':
      return coverService(svc, current, data, caps);
    case 'lock':
      return lockService(svc, current);
    case 'climate':
      return climateService(svc, current, data, caps);
    case 'media_player':
      return mediaService(svc, current, data, caps);
    case 'vacuum':
      return vacuumService(svc, current, data, caps, ctx.vacuum);
    case 'select': {
      if (svc !== 'select_option') return undefined;
      const option = data.option === undefined ? undefined : String(data.option);
      const options = caps.options ?? [];
      if (option === undefined) return result(current, current.state, attrsOf(current), ['Falta "option" en select.select_option']);
      if (options.length > 0 && !options.includes(option)) return result(current, current.state, attrsOf(current), [`Opción no disponible: ${option} (hay ${options.join(', ')})`]);
      return result(current, option, attrsOf(current));
    }
    case 'assist_satellite':
      return assistSatelliteService(svc, current, data);
    case 'camera':
      return cameraService(svc, current);
    case 'button':
      return svc === 'press' ? result(current, new Date(ctx.now).toISOString(), attrsOf(current)) : undefined;
    case 'alarm_control_panel':
      return alarmService(svc, current, data, caps, ctx.code ?? DEFAULT_ALARM_CODE);
    case 'valve':
      return valveService(svc, current);
    case 'siren':
      return switchService(svc, current);
    default:
      return undefined;
  }
}

// ---------- Descripción para el registro ----------

const fmt = (n: number, decimals = 1): string => String(round(n, decimals)).replace('.', ',');

function describeEntry(key: string, v: ServiceDataValue): string {
  const n = num(v);
  switch (key) {
    case 'brightness':
      return n === undefined ? `brillo ${String(v)}` : `brillo ${brightnessToPct(n)} %`;
    case 'brightness_pct':
      return `brillo ${String(v)} %`;
    case 'brightness_step_pct':
      return n === undefined ? `brillo ${String(v)}` : `brillo ${n >= 0 ? '+' : ''}${fmt(n)} %`;
    case 'color_temp_kelvin':
    case 'kelvin':
      return `${String(v)} K`;
    case 'rgb_color': {
      const rgb = parseRgb(v);
      return rgb ? `color rgb(${rgb.join(', ')})` : `color ${String(v)}`;
    }
    case 'position':
      return `posición ${String(v)} %`;
    case 'temperature':
      return n === undefined ? `consigna ${String(v)}` : `consigna ${fmt(n)} °C`;
    case 'hvac_mode':
      return `modo ${String(v)}`;
    case 'preset_mode':
      return `preset ${String(v)}`;
    case 'volume_level':
      return n === undefined ? `volumen ${String(v)}` : `volumen ${Math.round(n * 100)} %`;
    case 'is_volume_muted':
      return bool(v) === false ? 'con sonido' : 'silenciado';
    case 'source':
      return `fuente ${String(v)}`;
    case 'percentage':
      return `velocidad ${String(v)} %`;
    case 'code':
      return 'con código';
    case 'fan_mode':
      return `ventilador ${String(v)}`;
    case 'fan_speed':
      return `potencia ${String(v)}`;
    case 'message':
    case 'start_message':
      return `«${String(v)}»`;
    default:
      return `${key}: ${Array.isArray(v) ? `[${v.join(', ')}]` : String(v)}`;
  }
}

/** "brillo 60 %, 2700 K" a partir de los datos de una llamada (vacío si no hay datos). */
export function describeServiceData(data: ServiceData | undefined): string {
  if (!data) return '';
  return Object.entries(data)
    .map(([k, v]) => describeEntry(k, v))
    .join(', ');
}

// ---------- Escenas ----------

export interface ServiceCall {
  service: string;
  data?: ServiceData;
}

function pick(attrs: Attrs | undefined, keys: string[]): ServiceData | undefined {
  const data: ServiceData = {};
  for (const k of keys) if (attrs?.[k] !== undefined) data[k] = attrs[k];
  return Object.keys(data).length > 0 ? data : undefined;
}

function call(service: string, data?: ServiceData): ServiceCall {
  return data ? { service, data } : { service };
}

/**
 * Servicios equivalentes a fijar una entidad al estado de una escena (como hace HA), o
 * undefined si no hay equivalencia y el estado debe fijarse directamente.
 */
export function sceneServiceCalls(entityId: string, target: EntityState): ServiceCall[] | undefined {
  const domain = entityId.split('.')[0] ?? '';
  const st = target.state === true ? 'on' : target.state === false ? 'off' : String(target.state);
  const attrs = target.attributes;
  switch (domain) {
    case 'light':
      return st === 'off' ? [call('light.turn_off')] : st === 'on' ? [call('light.turn_on', pick(attrs, ['brightness', 'color_temp_kelvin', 'rgb_color']))] : undefined;
    case 'switch':
      return st === 'on' || st === 'off' ? [call(`switch.turn_${st}`)] : undefined;
    case 'fan':
      return st === 'off' ? [call('fan.turn_off')] : st === 'on' ? [call('fan.turn_on', pick(attrs, ['percentage']))] : undefined;
    case 'cover': {
      const pos = num(attrs?.current_position);
      if (pos !== undefined) return [call('cover.set_cover_position', { position: pos })];
      return st === 'open' ? [call('cover.open_cover')] : st === 'closed' ? [call('cover.close_cover')] : undefined;
    }
    case 'lock':
      return st === 'locked' ? [call('lock.lock')] : st === 'unlocked' ? [call('lock.unlock')] : undefined;
    case 'climate': {
      const calls = [st === 'off' ? call('climate.turn_off') : call('climate.set_hvac_mode', { hvac_mode: st })];
      if (attrs?.temperature !== undefined) calls.push(call('climate.set_temperature', { temperature: attrs.temperature }));
      if (attrs?.preset_mode !== undefined) calls.push(call('climate.set_preset_mode', { preset_mode: attrs.preset_mode }));
      return calls;
    }
    case 'media_player': {
      const byState: Record<string, string> = { off: 'turn_off', on: 'turn_on', playing: 'media_play', paused: 'media_pause', idle: 'media_stop' };
      const svc = byState[st];
      if (!svc) return undefined;
      const calls = [call(`media_player.${svc}`)];
      if (attrs?.volume_level !== undefined) calls.push(call('media_player.volume_set', { volume_level: attrs.volume_level }));
      if (attrs?.source !== undefined) calls.push(call('media_player.select_source', { source: attrs.source }));
      if (attrs?.is_volume_muted !== undefined) calls.push(call('media_player.volume_mute', { is_volume_muted: attrs.is_volume_muted }));
      return calls;
    }
    case 'vacuum':
      return st === 'cleaning' ? [call('vacuum.start')] : st === 'docked' || st === 'returning' ? [call('vacuum.return_to_base')] : undefined;
    case 'valve':
      return st === 'open' ? [call('valve.open_valve')] : st === 'closed' ? [call('valve.close_valve')] : undefined;
    case 'input_boolean':
      return st === 'on' || st === 'off' ? [call(`input_boolean.turn_${st}`)] : undefined;
    case 'input_select':
      return [call('input_select.select_option', { option: st })];
    case 'input_number':
    case 'input_text':
      return [call(`${domain}.set_value`, { value: target.state })];
    default:
      return undefined;
  }
}
