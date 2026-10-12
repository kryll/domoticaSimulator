// Utilidades de interfaz sobre los fallos simulados.
import type { Failures } from '../types';
import { NO_FAILURES, hasFailures as anyFailure } from '../simulation/connectivity';

export { NO_FAILURES };

export function hasFailures(f: Failures | undefined): boolean {
  return anyFailure(f ?? NO_FAILURES);
}

/** Textos cortos de los fallos activos («Sin Internet», «Corte de luz»...). */
export function failureLabels(f: Failures | undefined, deviceName: (id: string) => string): string[] {
  if (!f) return [];
  const out: string[] = [];
  if (f.internet) out.push('Sin Internet');
  if (f.powerOutage) out.push('Corte de luz');
  if (f.haRestarting) out.push('Home Assistant reiniciando');
  for (const id of f.devicesDown) out.push(`${deviceName(id)} caído`);
  return out;
}
