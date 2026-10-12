import type { EntityDefinition } from '../../types';

// Textos de los controles (fuera de los componentes para el refresco rápido de Vite).
export const HVAC_LABELS: Record<string, string> = {
  off: 'Apagado',
  heat: 'Calor',
  cool: 'Frío',
  auto: 'Auto',
  heat_cool: 'Calor/frío',
  dry: 'Secar',
  fan_only: 'Ventilar',
};

export const PRESET_LABELS: Record<string, string> = {
  eco: 'Eco',
  away: 'Ausente',
  comfort: 'Confort',
  boost: 'Turbo',
  home: 'En casa',
  sleep: 'Noche',
  none: 'Ninguno',
  frost_protection: 'Antiheladas',
  schedule: 'Programa',
};

export const LOCK_LABELS: Record<string, string> = {
  locked: 'Cerrada',
  unlocked: 'Abierta',
  locking: 'Cerrando…',
  unlocking: 'Abriendo…',
  jammed: 'Atascada',
  open: 'Puerta abierta',
};

export const VACUUM_LABELS: Record<string, string> = {
  cleaning: 'Limpiando',
  docked: 'En la base',
  idle: 'En reposo',
  paused: 'En pausa',
  returning: 'Volviendo a la base',
  error: 'Error',
};

export const BUTTON_ACTION_LABELS: Record<string, string> = {
  single: 'Pulsación',
  double: 'Doble',
  triple: 'Triple',
  hold: 'Mantener',
  long: 'Larga',
  release: 'Soltar',
  shake: 'Agitar',
  on: 'Encender',
  off: 'Apagar',
  brightness_up: 'Subir brillo',
  brightness_down: 'Bajar brillo',
  arrow_left: 'Izquierda',
  arrow_right: 'Derecha',
  toggle: 'Alternar',
};

export function isRemoteEntity(def: EntityDefinition): boolean {
  return def.key === 'action' || (def.capabilities?.buttonActions?.length ?? 0) > 0;
}

