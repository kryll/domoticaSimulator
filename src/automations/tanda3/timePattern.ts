import type { TimePatternTrigger } from '../../types';

/** Texto legible de un patrón de hora («cada 5 minutos», «a las 7:00:00»...). */
export function describeTimePattern(t: Pick<TimePatternTrigger, 'hours' | 'minutes' | 'seconds'>): string {
  const part = (v: string | undefined, unit: [string, string]) => {
    if (v === undefined || v === '' || v === '*') return null;
    if (v.startsWith('/')) return `cada ${v.slice(1)} ${Number(v.slice(1)) === 1 ? unit[0] : unit[1]}`;
    return `${unit[0]} ${v}`;
  };
  const bits = [part(t.hours, ['hora', 'horas']), part(t.minutes, ['minuto', 'minutos']), part(t.seconds, ['segundo', 'segundos'])].filter(
    (b): b is string => b !== null,
  );
  return bits.length === 0 ? 'cada segundo' : bits.join(', ');
}

/** Eventos habituales del bus de HA (sugerencias del campo). */
export const COMMON_EVENTS = ['timer.finished', 'timer.started', 'timer.cancelled', 'zha_event', 'call_service', 'automation_triggered', 'mobile_app_notification_action'];

