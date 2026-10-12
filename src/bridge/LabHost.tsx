import { Suspense, lazy, useEffect, useRef, useState, type RefObject } from 'react';
import { useBridgeStore } from './bridgeStore';
import { useLocalLab } from './localLab';
import { CONNECTION_LABELS, OTHER_TAB_MESSAGE } from './labels';
import { LAB_LOCK_NAME, acquireTabLock, type TabLockState } from './tabLock';

// El panel (nodos, tráfico, snapshots) se carga al abrirlo: no pesa en el arranque de la app.
const LabPanel = lazy(() => import('./LabPanel').then((m) => ({ default: m.LabPanel })));

/** Altura de la barra superior (el panel se coloca debajo, sin taparla). */
function useHeaderHeight(anchor: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const header = anchor.current?.closest('header');
    if (!header) return undefined;
    const measure = () => setHeight(Math.round(header.getBoundingClientRect().bottom));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [anchor]);
  return height;
}

/**
 * Punto de enganche del laboratorio en la barra superior: botón «Lab» (siempre visible), candado
 * entre pestañas (una sola controla el lab), arranque del puente (fuera de React) y panel lateral.
 */
export function LabHost() {
  const enabled = useLocalLab((s) => s.enabled);
  const connection = useBridgeStore((s) => s.connection);
  const live = useBridgeStore((s) => s.live);
  const open = useBridgeStore((s) => s.panelOpen);
  const anchor = useRef<HTMLSpanElement>(null);
  const top = useHeaderHeight(anchor);
  const [lock, setLock] = useState<TabLockState | undefined>(undefined);

  // Candado entre pestañas: solo la que lo tiene arranca el puente.
  useEffect(() => {
    if (!enabled) return undefined;
    const release = acquireTabLock(LAB_LOCK_NAME, (s) => {
      setLock(s);
      if (s === 'waiting') useBridgeStore.setState({ connection: 'other_tab', live: false, status: undefined });
    });
    return () => {
      release();
      setLock(undefined);
    };
  }, [enabled]);

  // El puente (cliente WS, mapeo, sincronización) se carga solo con el lab activado y el candado.
  const run = enabled && lock === 'held';
  useEffect(() => {
    if (!run) return undefined;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('./runtime').then((m) => {
      if (!cancelled) stop = m.startBridgeRuntime();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [run]);

  useEffect(() => {
    if (!enabled) useBridgeStore.setState({ connection: 'off', live: false, status: undefined });
  }, [enabled]);

  const tone = connection === 'connected' ? (live ? 'bg-emerald-600' : 'bg-amber-500') : connection === 'connecting' || connection === 'readonly' ? 'bg-amber-400' : connection === 'unauthorized' ? 'bg-red-600' : 'bg-slate-400';
  const state = !enabled
    ? 'desactivado'
    : connection === 'connected'
      ? live
        ? 'en vivo'
        : 'desacoplado'
      : connection === 'other_tab'
        ? 'otra pestaña'
        : CONNECTION_LABELS[connection].toLowerCase();
  const title = connection === 'other_tab' ? OTHER_TAB_MESSAGE : `Laboratorio (${state}): nodos, tráfico y snapshots`;
  return (
    <span ref={anchor} className="contents">
      <button
        type="button"
        onClick={() => useBridgeStore.getState().setPanel(!open)}
        aria-expanded={open}
        title={title}
        aria-label={`Lab: ${state}`}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden="true" />
        Lab
        {enabled && <span className="hidden text-slate-500 lg:inline">· {state}</span>}
      </button>
      {open && (
        <Suspense fallback={null}>
          <LabPanel top={top} />
        </Suspense>
      )}
    </span>
  );
}
