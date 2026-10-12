import { isOn } from './attrs';
import { Toggle } from './primitives';
import type { ControlProps } from './types';

/** Interruptores, enchufes, ventiladores y cámaras: encender / apagar. */
export function ToggleControl({ state, onService }: ControlProps) {
  const st = state?.state;
  const on = isOn(state) || st === 'recording' || st === 'streaming';
  return <Toggle label="Encender o apagar" checked={on} onChange={(v) => onService(v ? 'turn_on' : 'turn_off')} />;
}
