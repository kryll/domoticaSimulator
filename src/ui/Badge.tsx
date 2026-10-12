import type { ReactNode } from 'react';
import { cx } from './cx';

export type BadgeTone = 'slate' | 'sky' | 'green' | 'amber' | 'red' | 'violet';

const tones: Record<BadgeTone, string> = {
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  sky: 'bg-sky-50 text-sky-800 border-sky-200',
  green: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  red: 'bg-red-50 text-red-800 border-red-200',
  violet: 'bg-violet-50 text-violet-800 border-violet-200',
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  /** Color personalizado (sobrescribe el tono), p. ej. el color del protocolo. */
  color?: string;
  title?: string;
  className?: string;
}

export function Badge({ children, tone = 'slate', color, title, className }: BadgeProps) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center whitespace-nowrap rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide',
        !color && tones[tone],
        className,
      )}
      style={color ? { backgroundColor: `${color}1a`, borderColor: `${color}66`, color } : undefined}
    >
      {children}
    </span>
  );
}
