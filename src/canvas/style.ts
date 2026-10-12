import type { DeviceCategory, EntityState, Protocol } from '../types';

/** Color de cada protocolo (aristas, insignias y leyenda). */
export const PROTOCOL_COLORS: Record<Protocol, string> = {
  wifi: '#2563eb',
  ethernet: '#475569',
  zigbee: '#d97706',
  zwave: '#7c3aed',
  thread: '#0d9488',
  matter: '#db2777',
  ble: '#0284c7',
  rf433: '#65a30d',
};

/**
 * Tinta oscura de cada protocolo para texto e insignias: contraste AA (≥ 4,5:1) tanto con texto
 * blanco encima como sobre el fondo claro de la insignia. Las aristas usan PROTOCOL_COLORS.
 */
export const PROTOCOL_INK: Record<Protocol, string> = {
  wifi: '#1e40af',
  ethernet: '#334155',
  zigbee: '#92400e',
  zwave: '#5b21b6',
  thread: '#115e59',
  matter: '#9d174d',
  ble: '#075985',
  rf433: '#3f6212',
};

/** Icono (emoji) por categoría de dispositivo. */
export const CATEGORY_ICONS: Record<DeviceCategory, string> = {
  light: '💡',
  plug: '🔌',
  switch: '🎚️',
  sensor: '📟',
  climate: '🌡️',
  cover: '🪟',
  lock: '🔒',
  camera: '📷',
  speaker: '🔊',
  display: '🖥️',
  vacuum: '🧹',
  hub: '🛰️',
  network: '📶',
  server: '🏠',
};

const ACTIVE_STATES = new Set(['on', 'open', 'opening', 'unlocked', 'playing', 'cleaning', 'heat', 'cool', 'auto', 'recording', 'home']);

/** ¿El estado de entidad se considera "activo" (luz encendida, sensor disparado...)? */
export function isActiveState(state: EntityState | undefined): boolean {
  if (!state) return false;
  const v = state.state;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ACTIVE_STATES.has(v.toLowerCase());
  return false;
}

/** Texto legible de un estado. */
export function formatState(state: EntityState | undefined, unit?: string): string {
  if (!state) return '—';
  const v = state.state;
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'number') return `${Math.round(v * 10) / 10}${unit ? ` ${unit}` : ''}`;
  return unit && v !== '' && !Number.isNaN(Number(v)) ? `${v} ${unit}` : String(v);
}
