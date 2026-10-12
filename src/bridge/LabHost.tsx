import { Suspense, lazy, useEffect } from 'react';
import { useBridgeStore } from './bridgeStore';
import { useBridgeSettings } from './useBridge';
import { CONNECTION_LABELS } from './labels';

// El panel (nodos, tráfico, snapshots) se carga al abrirlo: no pesa en el arranque de la app.
const LabPanel = lazy(() => import('./LabPanel').then((m) => ({ default: m.LabPanel })));

/**
 * Punto de enganche del laboratorio en la barra superior: arranca el puente (fuera de React),
 * muestra un indicador cuando está activado y el panel lateral del lab.
 */
export function LabHost() {
  const settings = useBridgeSettings();
  const connection = useBridgeStore((s) => s.connection);
  const live = useBridgeStore((s) => s.live);
  const open = useBridgeStore((s) => s.panelOpen);
  // El puente (cliente WS, mapeo, sincronización) se carga solo cuando se activa el lab.
  const enabled = settings.enabled;
  useEffect(() => {
    if (!enabled) return undefined;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('./runtime').then((m) => {
      if (!cancelled) stop = m.startBridgeRuntime();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [enabled]);
  const tone = connection === 'connected' ? (live ? 'bg-emerald-600' : 'bg-amber-500') : connection === 'connecting' ? 'bg-amber-400' : 'bg-slate-400';
  const label = connection === 'connected' ? (live ? 'Lab en vivo' : 'Lab desacoplado') : `Lab: ${CONNECTION_LABELS[connection].toLowerCase()}`;
  return (
    <>
      {settings.enabled && (
        <button
          type="button"
          onClick={() => useBridgeStore.getState().setPanel(!open)}
          aria-expanded={open}
          title="Laboratorio: nodos, tráfico y snapshots"
          className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden="true" />
          {label}
        </button>
      )}
      {open && (
        <Suspense fallback={null}>
          <LabPanel />
        </Suspense>
      )}
    </>
  );
}
