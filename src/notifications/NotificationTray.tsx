import { useEffect, useId, useRef } from 'react';
import type { SimNotification } from '../types';
import { useSimulationStore } from '../store/simulationStore';
import { useExtrasStore } from '../store/extrasStore';
import { formatSimTime } from '../simulation/clock';
import { clearNotifications, markAllNotificationsRead } from '../simulation/logic';
import { Button } from '../ui/Button';

const EMPTY: SimNotification[] = [];

function markAllRead() {
  useSimulationStore.setState((s) => ({ sim: markAllNotificationsRead(s.sim) }));
}

function clearAll() {
  useSimulationStore.setState((s) => ({ sim: clearNotifications(s.sim) }));
}

/**
 * Bandeja de notificaciones simulada (acción notify): campana con contador en la barra superior
 * y un panel con aspecto de móvil.
 */
export function NotificationTray() {
  const notifications = useSimulationStore((s) => s.sim.notifications ?? EMPTY);
  const open = useExtrasStore((s) => s.notificationsOpen);
  const setOpen = useExtrasStore((s) => s.setNotificationsOpen);
  const unread = notifications.reduce((n, x) => n + (x.read ? 0 : 1), 0);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  // Lo que se ve en la bandeja abierta queda leído.
  useEffect(() => {
    if (open && unread > 0) markAllRead();
  }, [open, unread]);

  const sorted = [...notifications].reverse();

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unread > 0 ? `Notificaciones (${unread} sin leer)` : 'Notificaciones'}
        title="Notificaciones del móvil simulado"
        className="relative rounded-md px-2 py-1 text-base hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white"
            aria-hidden="true"
            data-testid="notification-count"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notificaciones del móvil"
          className="absolute right-0 z-50 mt-2 w-80 rounded-[2rem] border-4 border-slate-800 bg-slate-800 p-1 shadow-2xl"
        >
          <div className="flex max-h-[28rem] flex-col overflow-hidden rounded-[1.6rem] bg-gradient-to-b from-sky-900 to-slate-900">
            <div className="flex items-center justify-between px-4 pb-1 pt-2 text-[11px] font-semibold text-white/80">
              <span>Móvil</span>
              <span className="mx-auto h-1.5 w-16 rounded-full bg-slate-700" aria-hidden="true" />
              <span>{notifications.length}</span>
            </div>
            <ol className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto px-2 pb-2" aria-label="Mensajes">
              {sorted.length === 0 && (
                <li className="px-2 py-8 text-center text-sm text-white/70">Sin notificaciones. Usa la acción «Notificación» en una automatización.</li>
              )}
              {sorted.map((n) => (
                <li key={n.id} className="rounded-2xl bg-white/90 px-3 py-2 text-slate-800 shadow">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <span aria-hidden="true">🏠</span>Home Assistant
                    </span>
                    <time className="text-[11px] text-slate-500">{formatSimTime(n.at)}</time>
                  </div>
                  {n.title && <p className="text-sm font-semibold">{n.title}</p>}
                  <p className="whitespace-pre-wrap text-sm">{n.message}</p>
                </li>
              ))}
            </ol>
            {notifications.length > 0 && (
              <div className="flex justify-center border-t border-white/10 p-2">
                <Button size="sm" variant="ghost" className="!text-white hover:!bg-white/10" onClick={clearAll}>
                  Borrar todas
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
