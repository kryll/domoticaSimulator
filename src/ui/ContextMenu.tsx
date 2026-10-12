import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from './cx';

export type MenuEntry =
  | { kind: 'item'; id: string; label: string; onSelect: () => void; danger?: boolean; hint?: string; disabled?: boolean }
  | { kind: 'separator' }
  | { kind: 'header'; label: string };

export interface ContextMenuProps {
  x: number;
  y: number;
  label: string;
  entries: MenuEntry[];
  onClose: () => void;
}

/** Menú contextual accesible (role="menu"): flechas, Inicio/Fin, Intro y Escape. */
export function ContextMenu({ x, y, label, entries, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onScroll);
      previous?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') list[(i + 1) % list.length]?.focus();
    else if (e.key === 'ArrowUp') list[(i - 1 + list.length) % list.length]?.focus();
    else if (e.key === 'Home') list[0]?.focus();
    else if (e.key === 'End') list[list.length - 1]?.focus();
    else if (e.key === 'Escape' || e.key === 'Tab') onClose();
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-[14rem] rounded-md border border-slate-200 bg-white py-1 text-sm shadow-xl focus:outline-none"
      style={{ left: pos.left, top: pos.top }}
    >
      {entries.map((entry, i) => {
        if (entry.kind === 'separator') return <div key={`sep-${i}`} role="separator" className="my-1 h-px bg-slate-200" />;
        if (entry.kind === 'header')
          return (
            <div key={`h-${i}`} className="truncate px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500" role="presentation">
              {entry.label}
            </div>
          );
        return (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-disabled={entry.disabled ? 'true' : undefined}
            onClick={() => {
              if (entry.disabled) return;
              onClose();
              entry.onSelect();
            }}
            className={cx(
              'flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left focus:outline-none',
              entry.disabled ? 'cursor-not-allowed text-slate-400' : entry.danger ? 'text-red-700 hover:bg-red-50 focus:bg-red-50' : 'text-slate-700 hover:bg-sky-50 focus:bg-sky-50',
            )}
          >
            <span>{entry.label}</span>
            {entry.hint && <kbd className="font-mono text-[10px] text-slate-400">{entry.hint}</kbd>}
          </button>
        );
      })}
    </div>
  );
}
