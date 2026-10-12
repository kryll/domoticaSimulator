import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';
import { cx } from './cx';

/**
 * Aviso actual de la interfaz. Se muestra arriba y centrado sobre el lienzo para no tapar
 * el panel de Propiedades (derecha) ni el catálogo (izquierda).
 */
export function Toast() {
  const notice = useUiStore((s) => s.notice);
  const clear = useUiStore((s) => s.clearNotice);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clear, notice.details || notice.action ? 9000 : 4500);
    return () => clearTimeout(t);
  }, [notice, clear]);

  return (
    <div
      aria-live="polite"
      role="status"
      className="pointer-events-none fixed left-1/2 top-24 z-50 w-max max-w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2"
    >
      {notice && (
        <div
          className={cx(
            'pointer-events-auto flex items-start gap-3 rounded-md border px-4 py-2 text-sm shadow-lg',
            notice.kind === 'error' && 'border-red-300 bg-red-50 text-red-800',
            notice.kind === 'success' && 'border-emerald-300 bg-emerald-50 text-emerald-800',
            notice.kind === 'info' && 'border-sky-300 bg-sky-50 text-sky-800',
          )}
        >
          <div className="min-w-0">
            <p>{notice.text}</p>
            {notice.details && (
              <ul className="mt-1 list-disc pl-4 text-xs">
                {notice.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
            {notice.action && (
              <button
                type="button"
                onClick={() => {
                  notice.action?.run();
                  clear();
                }}
                className="mt-1 rounded-md border border-current px-2 py-0.5 text-xs font-semibold hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                {notice.action.label}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={clear}
            className="rounded px-1 text-xs hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            aria-label="Cerrar aviso"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
