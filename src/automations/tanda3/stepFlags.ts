import type { ActionFlags, StepToggle, Weekday } from '../../types';

/** Quita `enabled` cuando vale true (es el valor por defecto de HA). */
export function withEnabled<T extends StepToggle>(value: T, on: boolean): T {
  const next = { ...value };
  if (on) delete next.enabled;
  else next.enabled = false;
  return next;
}

export function withContinueOnError<T extends ActionFlags>(value: T, on: boolean): T {
  const next = { ...value };
  if (on) next.continueOnError = true;
  else delete next.continueOnError;
  return next;
}

export const WEEKDAYS: Array<{ key: Weekday; short: string; name: string }> = [
  { key: 'mon', short: 'L', name: 'lunes' },
  { key: 'tue', short: 'M', name: 'martes' },
  { key: 'wed', short: 'X', name: 'miércoles' },
  { key: 'thu', short: 'J', name: 'jueves' },
  { key: 'fri', short: 'V', name: 'viernes' },
  { key: 'sat', short: 'S', name: 'sábado' },
  { key: 'sun', short: 'D', name: 'domingo' },
];

