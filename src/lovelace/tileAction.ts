// Acción al pulsar una tarjeta tile del dashboard (solo interfaz).
import type { EntityState } from '../types';

export interface TileAction {
  service: string;
  label: string;
}

const ON = new Set(['on', 'open', 'opening', 'unlocked', 'cleaning', 'playing']);

/** Servicio que ejecuta la tarjeta según el dominio y el estado; null si no es controlable. */
export function tileAction(entityId: string, state: EntityState | undefined): TileAction | null {
  const domain = entityId.slice(0, entityId.indexOf('.'));
  const st = state?.state;
  if (st === 'unavailable') return null;
  const on = st === true || ON.has(String(st));
  switch (domain) {
    case 'light':
    case 'switch':
    case 'fan':
      return on ? { service: `${domain}.turn_off`, label: 'Apagar' } : { service: `${domain}.turn_on`, label: 'Encender' };
    case 'cover':
      return on ? { service: 'cover.close_cover', label: 'Cerrar' } : { service: 'cover.open_cover', label: 'Abrir' };
    case 'lock':
      return st === 'locked' ? { service: 'lock.unlock', label: 'Abrir' } : { service: 'lock.lock', label: 'Cerrar' };
    case 'vacuum':
      return st === 'cleaning' ? { service: 'vacuum.return_to_base', label: 'Volver a la base' } : { service: 'vacuum.start', label: 'Limpiar' };
    case 'button':
      return { service: 'button.press', label: 'Pulsar' };
    case 'media_player':
      return st === 'off' || st === 'standby' ? { service: 'media_player.turn_on', label: 'Encender' } : { service: 'media_player.turn_off', label: 'Apagar' };
    default:
      return null;
  }
}

/** ¿Se pinta la tarjeta como activa? */
export function tileActive(state: EntityState | undefined): boolean {
  const st = state?.state;
  return st === true || ON.has(String(st)) || st === 'home' || st === 'heat' || st === 'cool';
}

const DOMAIN_ICONS: Record<string, string> = {
  light: '💡',
  switch: '🔌',
  fan: '🌀',
  cover: '🪟',
  lock: '🔒',
  vacuum: '🧹',
  button: '🔘',
  person: '🧑',
  media_player: '🔊',
  climate: '🌡️',
  sensor: '📟',
  binary_sensor: '🔔',
  camera: '📷',
};

export function domainIcon(entityId: string): string {
  return DOMAIN_ICONS[entityId.slice(0, entityId.indexOf('.'))] ?? '❔';
}
