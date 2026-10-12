import type { ReactNode } from 'react';
import { cx } from './cx';

export interface PanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'aside' | 'div';
  'aria-label'?: string;
}

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  as: Tag = 'section',
  'aria-label': ariaLabel,
}: PanelProps) {
  return (
    <Tag className={cx('flex min-h-0 flex-col bg-white', className)} aria-label={ariaLabel}>
      {(title ?? actions) !== undefined && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
          {title !== undefined && (
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
          )}
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cx('min-h-0 flex-1 overflow-auto', bodyClassName)}>{children}</div>
    </Tag>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-3 py-6 text-center text-sm text-slate-500">{children}</p>;
}
