// Estados traducidos de las entidades (como la interfaz de Home Assistant en español).
// Tabla única: la usan las trazas, el lienzo, los selectores de estado de disparadores y
// condiciones, los controles y el informe. Lógica pura.
import type { EntityCapabilities, EntityStateValue } from '../types';
import { BUTTON_ACTION_LABELS, HVAC_MODE_LABELS, labelOf } from './labels';

export interface StateOption {
  value: string;
  label: string;
}

/** binary_sensor: [etiqueta de on, etiqueta de off] por device_class (traducciones de HA). */
export const BINARY_SENSOR_LABELS: Record<string, readonly [string, string]> = {
  battery: ['Bajo', 'Normal'],
  battery_charging: ['Cargando', 'No está cargando'],
  carbon_monoxide: ['Detectado', 'Despejado'],
  cold: ['Frío', 'Normal'],
  connectivity: ['Conectado', 'Desconectado'],
  door: ['Abierta', 'Cerrada'],
  garage_door: ['Abierta', 'Cerrada'],
  gas: ['Detectado', 'Despejado'],
  heat: ['Caliente', 'Normal'],
  light: ['Luz detectada', 'Sin luz'],
  lock: ['Desbloqueado', 'Bloqueado'],
  moisture: ['Húmedo', 'Seco'],
  motion: ['Detectado', 'Despejado'],
  moving: ['En movimiento', 'Parado'],
  occupancy: ['Detectado', 'Despejado'],
  opening: ['Abierto', 'Cerrado'],
  plug: ['Enchufado', 'Desenchufado'],
  power: ['Detectado', 'Despejado'],
  presence: ['En casa', 'Fuera'],
  problem: ['Problema', 'Correcto'],
  running: ['En marcha', 'Parado'],
  safety: ['Inseguro', 'Seguro'],
  smoke: ['Detectado', 'Despejado'],
  sound: ['Detectado', 'Despejado'],
  tamper: ['Manipulación', 'Despejado'],
  update: ['Actualización disponible', 'Actualizado'],
  vibration: ['Detectada', 'Despejada'],
  window: ['Abierta', 'Cerrada'],
};

const BINARY_DEFAULT: readonly [string, string] = ['Activado', 'Desactivado'];

/** Estados por dominio, en el orden en que se ofrecen en los selectores. */
export const DOMAIN_STATE_LABELS: Record<string, Record<string, string>> = {
  light: { on: 'Encendida', off: 'Apagada' },
  switch: { on: 'Encendido', off: 'Apagado' },
  fan: { on: 'Encendido', off: 'Apagado' },
  cover: { open: 'Abierta', closed: 'Cerrada', opening: 'Abriendo', closing: 'Cerrando' },
  lock: {
    locked: 'Bloqueada',
    unlocked: 'Desbloqueada',
    jammed: 'Atascada',
    locking: 'Bloqueando',
    unlocking: 'Desbloqueando',
    open: 'Abierta',
    opening: 'Abriendo',
  },
  climate: HVAC_MODE_LABELS,
  media_player: {
    playing: 'Reproduciendo',
    paused: 'En pausa',
    idle: 'Inactivo',
    off: 'Apagado',
    on: 'Encendido',
    standby: 'En espera',
    buffering: 'Cargando',
  },
  vacuum: {
    cleaning: 'Limpiando',
    docked: 'En la base',
    returning: 'Volviendo a la base',
    paused: 'En pausa',
    idle: 'Inactivo',
    error: 'Error',
  },
  camera: { idle: 'Inactiva', recording: 'Grabando', streaming: 'Transmitiendo', off: 'Apagada' },
  person: { home: 'En casa', not_home: 'Fuera' },
  device_tracker: { home: 'En casa', not_home: 'Fuera' },
  sun: { above_horizon: 'Sobre el horizonte', below_horizon: 'Bajo el horizonte' },
  script: { on: 'En ejecución', off: 'Parado' },
  automation: { on: 'Activada', off: 'Desactivada' },
};

/** Estados que no se ofrecen en los selectores aunque tengan traducción (transitorios). */
const HIDDEN_OPTIONS: Record<string, readonly string[]> = {
  lock: ['opening'],
  media_player: ['buffering'],
  camera: ['off'],
};

/** Estados comunes a todas las entidades. */
const COMMON_LABELS: Record<string, string> = { unavailable: 'No disponible', unknown: 'Desconocido' };

/** Modos de climate que se ofrecen si no se conocen los de la entidad. */
const DEFAULT_HVAC_MODES = ['heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only', 'off'];

const domainOf = (entityIdOrDomain: string): string => {
  const dot = entityIdOrDomain.indexOf('.');
  return dot === -1 ? entityIdOrDomain : entityIdOrDomain.slice(0, dot);
};

const text = (value: EntityStateValue): string => (value === true ? 'on' : value === false ? 'off' : String(value));

/**
 * Estados posibles de una entidad, traducidos, según su dominio y su device_class (como HA).
 * `capabilities` afina climate (hvacModes) y los mandos (buttonActions del sensor de acción).
 * Los sensores numéricos devuelven [] (se comparan con numeric_state).
 */
export function stateOptions(domain: string, deviceClass?: string, capabilities?: EntityCapabilities): StateOption[] {
  const d = domainOf(domain);
  if (d === 'binary_sensor') {
    const [on, off] = BINARY_SENSOR_LABELS[deviceClass ?? ''] ?? BINARY_DEFAULT;
    return [
      { value: 'on', label: on },
      { value: 'off', label: off },
    ];
  }
  if (d === 'climate') {
    const modes = capabilities?.hvacModes?.length ? capabilities.hvacModes : DEFAULT_HVAC_MODES;
    return modes.map((value) => ({ value, label: labelOf(HVAC_MODE_LABELS, value) }));
  }
  if (d === 'sensor') {
    const actions = capabilities?.buttonActions ?? [];
    return actions.map((value) => ({ value, label: labelOf(BUTTON_ACTION_LABELS, value) }));
  }
  const table = DOMAIN_STATE_LABELS[d];
  if (!table) return [];
  const hidden = HIDDEN_OPTIONS[d] ?? [];
  return Object.entries(table)
    .filter(([value]) => !hidden.includes(value))
    .map(([value, label]) => ({ value, label }));
}

/**
 * Etiqueta legible de un estado: stateLabel('light.salon', 'on') → «Encendida»;
 * stateLabel('binary_sensor', 'on', 'motion') → «Detectado». Acepta un entity_id o un dominio.
 * Si no hay traducción devuelve el valor tal cual.
 */
export function stateLabel(entityIdOrDomain: string, value: EntityStateValue, deviceClass?: string): string {
  const s = text(value);
  const common = COMMON_LABELS[s];
  if (common) return common;
  const d = domainOf(entityIdOrDomain);
  if (d === 'binary_sensor') {
    const [on, off] = BINARY_SENSOR_LABELS[deviceClass ?? ''] ?? BINARY_DEFAULT;
    if (s === 'on') return on;
    if (s === 'off') return off;
    return s;
  }
  // Sensor de acción de un mando (sensor.<mando>_action): single → «Pulsación».
  if (d === 'sensor' && (entityIdOrDomain === 'sensor' || entityIdOrDomain.endsWith('_action'))) return BUTTON_ACTION_LABELS[s] ?? s;
  const table = DOMAIN_STATE_LABELS[d];
  return table ? labelOf(table, s) : s;
}
