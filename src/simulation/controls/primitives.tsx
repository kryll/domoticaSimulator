import { useId, useRef, useState, type ReactNode } from 'react';
import { cx } from '../../ui/cx';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Texto del valor (visible y para lectores de pantalla). */
  format?: (v: number) => string;
  onCommit: (v: number) => void;
  disabled?: boolean;
  /** Fondo del carril (p. ej. degradado de temperatura de color). */
  trackStyle?: string;
}

/**
 * Deslizador con etiqueta visible y valor. Mientras se arrastra con el ratón solo actualiza el
 * borrador; confirma al soltar. Con teclado confirma en cada paso.
 */
export function Slider({ label, value, min, max, step = 1, format = String, onCommit, disabled, trackStyle }: SliderProps) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  const dragging = useRef(false);
  if (seen !== value) {
    setSeen(value);
    if (!dragging.current) setDraft(value);
  }
  const commit = (v: number) => {
    if (v !== value) onCommit(v);
  };
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-xs font-medium text-slate-600">
          {label}
        </label>
        <output htmlFor={id} className="text-xs font-semibold tabular-nums text-slate-800">
          {format(draft)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        aria-valuetext={format(draft)}
        className="h-2 w-full cursor-pointer appearance-auto accent-sky-600 disabled:cursor-not-allowed"
        style={trackStyle ? { background: trackStyle, borderRadius: 4 } : undefined}
        onPointerDown={() => {
          dragging.current = true;
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          commit(Number(e.currentTarget.value));
        }}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDraft(v);
          if (!dragging.current) commit(v);
        }}
      />
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

/** Grupo de botones excluyentes (modo HVAC, fuente...). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<SegmentOption<T>>;
  value: T | undefined;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((o) => (
          <CtlButton key={o.value} pressed={value === o.value} onClick={() => onChange(o.value)} title={o.title}>
            {o.label}
          </CtlButton>
        ))}
      </div>
    </div>
  );
}

export function CtlButton({
  children,
  onClick,
  pressed,
  title,
  label,
  variant = 'default',
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  pressed?: boolean;
  title?: string;
  label?: string;
  variant?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      title={title ?? label}
      disabled={disabled}
      className={cx(
        'inline-flex min-h-[28px] items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 disabled:opacity-50',
        pressed
          ? 'border-sky-700 bg-sky-600 text-white hover:bg-sky-700'
          : variant === 'primary'
            ? 'border-sky-700 bg-sky-600 text-white hover:bg-sky-700'
            : variant === 'danger'
              ? 'border-red-300 bg-white text-red-700 hover:bg-red-50'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}

/** Interruptor accesible (role="switch"). */
export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 rounded-md text-xs font-medium text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      <span className={cx('relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-amber-400' : 'bg-slate-300')}>
        <span
          className={cx(
            'absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform motion-reduce:transition-none',
            checked ? 'translate-x-4' : 'translate-x-0.5',
          )}
        />
      </span>
      {checked ? 'Encendido' : 'Apagado'}
    </button>
  );
}

/** Ajuste numérico con − / + y valor visible. */
export function Stepper({
  label,
  value,
  step,
  min,
  max,
  format,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <div className="flex items-center gap-2" role="group" aria-label={label}>
        <CtlButton label={`Bajar ${label.toLowerCase()}`} onClick={() => onChange(clamp(value - step))} disabled={value <= min}>
          −
        </CtlButton>
        <span className="min-w-[4rem] text-center text-lg font-semibold tabular-nums text-slate-800" aria-live="polite">
          {format(value)}
        </span>
        <CtlButton label={`Subir ${label.toLowerCase()}`} onClick={() => onChange(clamp(value + step))} disabled={value >= max}>
          +
        </CtlButton>
      </div>
    </div>
  );
}
