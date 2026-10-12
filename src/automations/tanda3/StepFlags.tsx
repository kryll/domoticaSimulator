import { useId, type ReactNode } from 'react';
import type { ActionFlags, StepToggle, Weekday } from '../../types';
import { cx } from '../../ui/cx';

/** Interruptor accesible (role=switch) con etiqueta visible. */
export function SwitchToggle({ checked, onChange, label, srLabel }: { checked: boolean; onChange: (on: boolean) => void; label: string; srLabel?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={srLabel}
      onClick={() => onChange(!checked)}
      className="inline-flex min-h-[1.75rem] items-center gap-1.5 rounded-md px-1 text-xs text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      <span
        aria-hidden="true"
        className={cx('relative inline-block h-4 w-7 rounded-full transition-colors', checked ? 'bg-sky-600' : 'bg-slate-300')}
      >
        <span className={cx('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all', checked ? 'left-3.5' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}

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

/**
 * Paso de una automatización con su interruptor «Activado» (y, en las acciones, «Seguir si
 * falla»). Un paso desactivado se ve atenuado: HA lo ignora.
 */
export function StepShell<T extends ActionFlags>({
  value,
  onChange,
  kind,
  children,
}: {
  value: T;
  onChange: (v: T) => void;
  kind: 'disparador' | 'condición' | 'acción';
  children: ReactNode;
}) {
  const enabled = value.enabled !== false;
  return (
    <div data-step-enabled={enabled ? 'true' : 'false'}>
      <div className="mb-1 flex flex-wrap items-center justify-end gap-x-3">
        {!enabled && <span className="mr-auto rounded bg-slate-200 px-1.5 text-[11px] font-semibold text-slate-700">Desactivado: se ignora</span>}
        {kind === 'acción' && (
          <SwitchToggle
            checked={value.continueOnError === true}
            onChange={(on) => onChange(withContinueOnError(value, on))}
            label="Seguir si falla"
            srLabel={`Seguir si falla esta ${kind}`}
          />
        )}
        <SwitchToggle checked={enabled} onChange={(on) => onChange(withEnabled(value, on))} label="Activado" srLabel={`Activado: ${kind}`} />
      </div>
      <div className={cx(!enabled && 'opacity-60')}>{children}</div>
    </div>
  );
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

/** Chips L-M-X-J-V-S-D. Ninguno marcado = todos los días. */
export function WeekdayChips({ value, onChange }: { value: Weekday[] | undefined; onChange: (days: Weekday[] | undefined) => void }) {
  const labelId = useId();
  const days = value ?? [];
  const toggle = (d: Weekday) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    const ordered = WEEKDAYS.map((w) => w.key).filter((k) => next.includes(k));
    onChange(ordered.length === 0 ? undefined : ordered);
  };
  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-xs font-medium text-slate-600">
        Días de la semana {days.length === 0 && <span className="font-normal text-slate-500">(todos)</span>}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1">
        {WEEKDAYS.map((d) => (
          <button
            key={d.key}
            type="button"
            aria-pressed={days.includes(d.key)}
            aria-label={d.name}
            title={d.name}
            onClick={() => toggle(d.key)}
            className={cx(
              'h-8 w-8 rounded-full border text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
              days.includes(d.key) ? 'border-sky-700 bg-sky-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            {d.short}
          </button>
        ))}
      </div>
      <div className="flex gap-2 text-[11px]">
        <button type="button" className="text-sky-700 hover:underline" onClick={() => onChange(['mon', 'tue', 'wed', 'thu', 'fri'])}>
          Laborables
        </button>
        <button type="button" className="text-sky-700 hover:underline" onClick={() => onChange(['sat', 'sun'])}>
          Fin de semana
        </button>
      </div>
    </div>
  );
}
