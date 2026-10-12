import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';
import { cx } from './cx';

/** Muestra el aviso actual de la interfaz (errores de conexión, importación, etc.). */
export function Toast() {
  const notice = useUiStore((s) => s.notice);
  const clear = useUiStore((s) => s.clearNotice);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clear, 5000);
    return () => clearTimeout(t);
  }, [notice, clear]);

  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      {notice && (
        <div
          className={cx(
            'pointer-events-auto flex items-center gap-3 rounded-md border px-4 py-2 text-sm shadow-lg',
            notice.kind === 'error' && 'border-red-300 bg-red-50 text-red-800',
            notice.kind === 'success' && 'border-emerald-300 bg-emerald-50 text-emerald-800',
            notice.kind === 'info' && 'border-sky-300 bg-sky-50 text-sky-800',
          )}
        >
          <span>{notice.text}</span>
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
