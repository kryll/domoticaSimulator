import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useConfirmStore } from './confirm';
import { Button } from './Button';
import { trapTab } from './focusTrap';

/** Diálogo de confirmación accesible (role="alertdialog"), con el foco gestionado. */
export function ConfirmDialog() {
  const current = useConfirmStore((s) => s.queue[0]);
  const answer = useConfirmStore((s) => s.answer);
  const titleId = useId();
  const descId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const currentId = current?.id;
  const danger = current?.danger ?? false;

  useEffect(() => {
    if (currentId === undefined) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (danger ? cancelRef.current : okRef.current)?.focus();
    // Captura en window: Escape cierra solo este diálogo, no el modal que haya debajo.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      useConfirmStore.getState().answer(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [currentId, danger]);

  if (!current) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) answer(false);
      }}
    >
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={current.message || current.details ? descId : undefined}
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
        onKeyDown={(e) => trapTab(e, ref.current)}
      >
        <div className="px-4 pb-2 pt-4">
          <h2 id={titleId} className="text-base font-semibold text-slate-800">
            {current.title}
          </h2>
          <div id={descId} className="mt-1 text-sm text-slate-600">
            {current.message && <p>{current.message}</p>}
            {current.details && current.details.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-slate-700">
                {current.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <Button ref={cancelRef} onClick={() => answer(false)}>
            {current.cancelLabel ?? 'Cancelar'}
          </Button>
          <Button
            ref={okRef}
            variant={danger ? 'danger' : 'primary'}
            className={danger ? '!border-red-700 !bg-red-600 !text-white hover:!bg-red-700' : undefined}
            onClick={() => answer(true)}
          >
            {current.confirmLabel ?? 'Aceptar'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
