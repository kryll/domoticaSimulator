import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

export type DropdownEntry =
  | {
      kind: 'item';
      id: string;
      label: string;
      onSelect: () => void;
      /** Casilla (menuitemcheckbox) o radio (menuitemradio) marcada. */
      checked?: boolean;
      role?: 'menuitem' | 'menuitemcheckbox' | 'menuitemradio';
      hint?: string;
      title?: string;
      disabled?: boolean;
      /** Deja el menú abierto tras elegir (útil para casillas). */
      keepOpen?: boolean;
    }
  | { kind: 'separator'; id: string }
  | { kind: 'header'; id: string; label: string };

export interface DropdownProps {
  /** Contenido del botón (sin la flecha). */
  label: ReactNode;
  /** Nombre accesible del botón si `label` no es texto. */
  ariaLabel?: string;
  entries: DropdownEntry[];
  /** Resalta el botón (p. ej. un modo activo dentro del menú). */
  active?: boolean;
  title?: string;
  align?: 'left' | 'right';
  className?: string;
  buttonClassName?: string;
}

/** Botón con menú desplegable accesible (role="menu"): flechas, Inicio/Fin, Intro y Escape. */
export function Dropdown({ label, ariaLabel, entries, active, title, align = 'left', className, buttonClassName }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])')?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (focus = true) => {
    setOpen(false);
    if (focus) buttonRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = [...(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus();
    else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus();
    else if (e.key === 'Home') list[0]?.focus();
    else if (e.key === 'End') list[list.length - 1]?.focus();
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') close(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={ref} className={cx('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        title={title}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cx(
          'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-1 text-xs font-medium transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
          active ? 'border-sky-700 bg-sky-600 text-white hover:bg-sky-700' : 'border-transparent bg-transparent text-slate-600 hover:bg-slate-100',
          buttonClassName,
        )}
      >
        {label}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
          onKeyDown={onKeyDown}
          className={cx(
            'absolute z-50 mt-1 max-h-[70vh] min-w-[12rem] overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {entries.map((entry) => {
            if (entry.kind === 'separator') return <div key={entry.id} role="separator" className="my-1 h-px bg-slate-200" />;
            if (entry.kind === 'header')
              return (
                <div key={entry.id} role="presentation" className="px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {entry.label}
                </div>
              );
            const role = entry.role ?? (entry.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
            return (
              <button
                key={entry.id}
                type="button"
                role={role}
                tabIndex={-1}
                title={entry.title}
                aria-checked={role === 'menuitem' ? undefined : (entry.checked ?? false)}
                aria-disabled={entry.disabled ? 'true' : undefined}
                onClick={() => {
                  if (entry.disabled) return;
                  if (!entry.keepOpen) close();
                  entry.onSelect();
                }}
                className={cx(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left focus:outline-none',
                  entry.disabled ? 'cursor-not-allowed text-slate-400' : 'text-slate-700 hover:bg-sky-50 focus:bg-sky-50',
                )}
              >
                {role !== 'menuitem' && (
                  <span aria-hidden="true" className="w-4 text-center text-sky-700">
                    {entry.checked ? (role === 'menuitemradio' ? '●' : '✓') : ''}
                  </span>
                )}
                <span className="flex-1">{entry.label}</span>
                {entry.hint && <kbd className="font-mono text-[10px] text-slate-400">{entry.hint}</kbd>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
