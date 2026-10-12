// Estado de las entidades del simulador → mensajes MQTT (perfil genérico y Z2M). Funciones puras.
import type { EntityState, EntityStateValue } from '../../types';
import type { BridgeDevice, BridgeEntity } from './model';
import { kelvinToMired, parseRgbText, rgbToXy } from './color';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type Fields = Record<string, Json>;

const UNAVAILABLE = new Set(['unavailable', 'unknown']);

const num = (v: EntityStateValue | undefined): number | undefined => {
  if (v === undefined || typeof v === 'boolean') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && String(v).trim() !== '' ? n : undefined;
};

const isOn = (st: EntityState): boolean => st.state === 'on' || st.state === true;
const onOff = (st: EntityState): 'ON' | 'OFF' => (isOn(st) ? 'ON' : 'OFF');

/** Modos de color admitidos por la luz en el discovery (HA no deja mezclar onoff/brightness con otros). */
export function supportedColorModes(entity: BridgeEntity, profile: 'z2m' | 'generic'): string[] {
  const modes = entity.caps.colorModes ?? ['brightness'];
  const colour = modes.filter((m) => m === 'color_temp' || m === 'rgb').map((m) => (m === 'rgb' && profile === 'z2m' ? 'xy' : m));
  if (colour.length > 0) return colour;
  return modes.some((m) => m !== 'onoff') ? ['brightness'] : ['onoff'];
}

/** Brillo 0-255 del simulador a la escala del perfil (Z2M: 0-254). */
export function scaleBrightness(b: number, profile: 'z2m' | 'generic'): number {
  return profile === 'z2m' ? Math.round((Math.max(0, Math.min(255, b)) * 254) / 255) : Math.round(Math.max(0, Math.min(255, b)));
}

function lightFields(entity: BridgeEntity, st: EntityState, profile: 'z2m' | 'generic'): Fields {
  const attrs = st.attributes ?? {};
  const fields: Fields = { state: onOff(st) };
  if (!isOn(st)) return fields;
  const supported = supportedColorModes(entity, profile);
  const brightness = num(attrs.brightness);
  if (brightness !== undefined && !supported.includes('onoff')) fields.brightness = scaleBrightness(brightness, profile);
  const kelvin = num(attrs.color_temp_kelvin);
  const rgb = parseRgbText(attrs.rgb_color);
  let mode: string | undefined;
  if (rgb && (supported.includes('rgb') || supported.includes('xy'))) {
    if (profile === 'z2m') {
      fields.color = rgbToXy(rgb);
      mode = 'xy';
    } else {
      fields.color = { r: rgb[0], g: rgb[1], b: rgb[2] };
      mode = 'rgb';
    }
  } else if (kelvin !== undefined && supported.includes('color_temp')) {
    fields.color_temp = kelvinToMired(kelvin);
    mode = 'color_temp';
  }
  fields.color_mode = mode ?? supported[0] ?? 'onoff';
  return fields;
}

function climateFields(st: EntityState): Fields {
  const a = st.attributes ?? {};
  const fields: Fields = { mode: String(st.state) };
  const target = num(a.temperature);
  const current = num(a.current_temperature);
  if (target !== undefined) fields.temperature = target;
  if (current !== undefined) fields.current_temperature = current;
  if (a.hvac_action !== undefined) fields.action = String(a.hvac_action);
  if (a.preset_mode !== undefined) fields.preset = String(a.preset_mode);
  return fields;
}

/**
 * Campos del documento JSON de estado de una entidad en el perfil genérico (lo que se publica en
 * su state_topic). undefined si no hay nada que publicar (no disponible o un botón).
 */
export function genericFields(entity: BridgeEntity, st: EntityState | undefined): Fields | undefined {
  if (!st || UNAVAILABLE.has(String(st.state))) return undefined;
  const a = st.attributes ?? {};
  switch (entity.domain) {
    case 'light':
      return lightFields(entity, st, 'generic');
    case 'switch':
    case 'binary_sensor':
      return { state: onOff(st) };
    case 'fan': {
      const pct = num(a.percentage);
      return pct === undefined ? { state: onOff(st) } : { state: onOff(st), percentage: pct };
    }
    case 'sensor': {
      const n = num(st.state);
      return { state: n ?? String(st.state) };
    }
    case 'cover': {
      const pos = num(a.current_position);
      return pos === undefined ? { state: String(st.state) } : { state: String(st.state), position: pos };
    }
    case 'climate':
      return climateFields(st);
    case 'lock':
      return { state: String(st.state).toUpperCase() };
    case 'media_player': {
      const vol = num(a.volume_level);
      const fields: Fields = { state: String(st.state), power: st.state === 'off' ? 'OFF' : 'ON', muted: a.is_volume_muted === true };
      if (vol !== undefined) fields.volume = Math.round(vol * 100);
      if (a.source !== undefined) fields.source = String(a.source);
      return fields;
    }
    case 'button':
      return undefined;
    case 'siren':
      return { state: onOff(st) };
    case 'alarm_control_panel':
    case 'valve':
      return { state: String(st.state) };
    default:
      return { state: typeof st.state === 'boolean' ? onOff(st) : st.state };
  }
}

/**
 * Texto que se publica en el state_topic de la entidad (perfil genérico), o undefined.
 * Las claves van ordenadas para que el texto sea estable (deduplicación por hash).
 */
export function entityStateToPayload(entity: BridgeEntity, st: EntityState | undefined): string | undefined {
  const fields = genericFields(entity, st);
  return fields === undefined ? undefined : stableJson(fields);
}

/** JSON con las claves ordenadas. */
export function stableJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k] as Json)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Sufijo de endpoint de una propiedad Z2M (state_l2 → _l2). */
function endpointSuffix(property: string): string {
  const m = /_l\d+$/.exec(property);
  return m ? m[0] : '';
}

/** Campos Z2M que aporta una entidad al JSON del dispositivo. */
export function z2mFields(entity: BridgeEntity, st: EntityState | undefined): Fields | undefined {
  if (!st || UNAVAILABLE.has(String(st.state))) return undefined;
  const a = st.attributes ?? {};
  const p = entity.property;
  switch (entity.domain) {
    case 'light': {
      const f = lightFields(entity, st, 'z2m');
      const sfx = endpointSuffix(p);
      return sfx === '' ? f : Object.fromEntries(Object.entries(f).map(([k, v]) => [`${k}${sfx}`, v]));
    }
    case 'switch':
      return { [p]: onOff(st) };
    case 'binary_sensor':
      // Z2M publica contact=true con la puerta cerrada (al revés que HA).
      return { [p]: p.startsWith('contact') ? !isOn(st) : isOn(st) };
    case 'sensor': {
      const n = num(st.state);
      return { [p]: n ?? String(st.state) };
    }
    case 'cover': {
      const pos = num(a.current_position);
      const moving = st.state === 'opening' ? 'UP' : st.state === 'closing' ? 'DOWN' : 'STOP';
      const fields: Fields = { state: st.state === 'closed' ? 'CLOSE' : 'OPEN', moving };
      if (pos !== undefined) fields.position = pos;
      return fields;
    }
    case 'climate': {
      const c = climateFields(st);
      const fields: Fields = { system_mode: String(st.state) };
      if (c.temperature !== undefined) fields.occupied_heating_setpoint = c.temperature;
      if (c.current_temperature !== undefined) fields.local_temperature = c.current_temperature;
      if (c.action !== undefined) fields.running_state = c.action === 'heating' ? 'heat' : c.action === 'cooling' ? 'cool' : 'idle';
      if (c.preset !== undefined) fields.preset = c.preset;
      return fields;
    }
    case 'lock': {
      const s = String(st.state);
      return { state: s === 'locked' ? 'LOCK' : s === 'jammed' ? 'JAMMED' : 'UNLOCK', lock_state: s === 'jammed' ? 'not_fully_locked' : s };
    }
    default: {
      const g = genericFields(entity, st);
      return g === undefined ? undefined : Object.fromEntries(Object.entries(g).map(([k, v]) => [k === 'state' ? p : `${p}_${k}`, v]));
    }
  }
}

/** Calidad de enlace estable (40-200) derivada de la dirección IEEE: la radio está modelada. */
export function linkQuality(ieee: string): number {
  let h = 0;
  for (const c of ieee) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 40 + (h % 161);
}

/** JSON completo del dispositivo Z2M (todas sus entidades + linkquality), o undefined. */
export function z2mDevicePayload(bdev: BridgeDevice, entities: Readonly<Record<string, EntityState>>): string | undefined {
  const doc: Fields = {};
  let any = false;
  for (const e of bdev.entities) {
    const f = z2mFields(e, entities[e.entityId]);
    if (!f) continue;
    Object.assign(doc, f);
    any = true;
  }
  if (!any) return undefined;
  doc.linkquality = linkQuality(bdev.ieee);
  return stableJson(doc);
}
