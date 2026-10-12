// Utilidades de formulario para editores de automatizaciones y scripts (solo interfaz).
import type { EntityStateValue } from '../types';

/** Convierte el texto de un input en un valor de estado (número si lo parece). */
export function parseStateInput(text: string): EntityStateValue | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  if (t === 'true') return true;
  if (t === 'false') return false;
  const n = Number(t);
  if (!Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(t)) return n;
  return t;
}

export function stateToInput(v: EntityStateValue | undefined): string {
  return v === undefined ? '' : String(v);
}

export function parseNumberInput(text: string): number | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

/** Separa por comas o saltos de línea que no estén dentro de [], {}, () ni comillas. */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '[' || ch === '{' || ch === '(') {
      depth++;
    } else if ((ch === ']' || ch === '}' || ch === ')') && depth > 0) {
      depth--;
    } else if ((ch === ',' || ch === '\n') && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/** "brightness=200, rgb_color=[255,0,0]" -> { brightness: 200, rgb_color: '[255,0,0]' } */
export function parseDataInput(text: string): Record<string, EntityStateValue> | undefined {
  const out: Record<string, EntityStateValue> = {};
  for (const part of splitTopLevel(text)) {
    const [k, ...rest] = part.split('=');
    const key = k?.trim();
    if (!key) continue;
    const value = parseStateInput(rest.join('='));
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function dataToInput(data: Record<string, EntityStateValue> | undefined): string {
  if (!data) return '';
  return Object.entries(data)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ');
}

/** Servicios habituales de HA por dominio de entidad. */
export const SERVICES_BY_DOMAIN: Record<string, string[]> = {
  light: ['turn_on', 'turn_off', 'toggle'],
  switch: ['turn_on', 'turn_off', 'toggle'],
  fan: ['turn_on', 'turn_off', 'toggle'],
  cover: ['open_cover', 'close_cover', 'stop_cover'],
  lock: ['lock', 'unlock'],
  climate: ['turn_on', 'turn_off', 'set_temperature', 'set_hvac_mode'],
  media_player: ['turn_on', 'turn_off', 'media_play', 'media_pause', 'volume_set'],
  vacuum: ['start', 'pause', 'return_to_base'],
  camera: ['turn_on', 'turn_off', 'snapshot'],
  button: ['press'],
  sensor: [],
  binary_sensor: [],
};

export function servicesForEntity(entityId: string): string[] {
  const domain = entityId.split('.')[0] ?? '';
  const list = SERVICES_BY_DOMAIN[domain] ?? ['turn_on', 'turn_off'];
  return list.map((s) => `${domain}.${s}`);
}

/** Segundos -> "m:ss" (vacío si no hay valor). */
export function durationToInput(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * "m:ss", "h:mm:ss" o un número de segundos -> segundos. Vacío -> undefined.
 * Devuelve null si el texto no es válido.
 */
export function parseDurationInput(text: string): number | undefined | null {
  const t = text.trim();
  if (t === '') return undefined;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t));
  const parts = t.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  const total = nums.reduce((acc, n) => acc * 60 + n, 0);
  return total > 0 ? total : undefined;
}
