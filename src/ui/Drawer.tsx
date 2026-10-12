import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from './cx';
import { trapTab } from './focusTrap';

export interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  /** left: cajón lateral; bottom: hoja inferior. */
  side?: 'left' | 'right' | 'bottom';
  children: ReactNode;
  id?: string;
}

/**
 * Cajón u hoja inferior modal para pantallas estrechas: atrapa el foco, Esc o el fondo lo cierran
 * y al cerrar devuelve el foco a donde estaba.
 */
export function Drawer({ open, title, onClose, side = 'left', children, id }: DrawerProps) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Un diálogo o menú abierto encima recibe antes el Escape.
      if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 bg-slate-900/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => trapTab(e, ref.current)}
        className={cx(
          'absolute flex flex-col bg-white shadow-2xl focus:outline-none',
          side === 'left' && 'inset-y-0 left-0 w-[min(22rem,88vw)]',
          side === 'right' && 'inset-y-0 right-0 w-[min(22rem,88vw)]',
          side === 'bottom' && 'inset-x-0 bottom-0 max-h-[80vh] rounded-t-xl',
        )}
      >
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-1">
          {side === 'bottom' && <span className="absolute left-1/2 top-1 h-1 w-10 -translate-x-1/2 rounded-full bg-slate-300" aria-hidden="true" />}
          <h2 id={titleId} className="text-sm font-semibold text-slate-800">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Cerrar ${title.toLowerCase()}`}
            className="flex h-11 w-11 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
          >
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>
  );
}
