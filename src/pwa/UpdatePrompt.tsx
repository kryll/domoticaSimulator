import { usePwaStore } from './pwaStore';

/** Aviso «Hay una versión nueva» con el botón para recargar. */
export function UpdatePrompt() {
  const ready = usePwaStore((s) => s.updateReady);
  const apply = usePwaStore((s) => s.applyUpdate);
  const dismiss = usePwaStore((s) => s.dismiss);
  if (!ready) return null;
  return (
    <div
      role="status"
      className="fixed bottom-3 left-1/2 z-[70] flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-md border border-sky-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-lg"
    >
      <span>Hay una versión nueva de HA Simulator.</span>
      <button
        type="button"
        onClick={() => apply?.()}
        className="min-h-[2rem] rounded-md bg-sky-700 px-3 text-sm font-semibold text-white hover:bg-sky-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1"
      >
        Recargar
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Más tarde"
        className="min-h-[2rem] rounded-md px-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        ✕
      </button>
    </div>
  );
}
