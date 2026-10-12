import { Suspense, lazy, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { TopBar } from './ui/TopBar';
import { BottomPanel } from './ui/BottomPanel';
import { Toast } from './ui/Toast';
import { CatalogPanel } from './catalog/CatalogPanel';
import { Canvas } from './canvas/Canvas';
import { FloorBar } from './canvas/FloorBar';
import { PropertiesPanel } from './canvas/PropertiesPanel';
import { startAutosave, useProjectStore } from './store/projectStore';
import { startInteractAutoplay, startSimulationSync, stopSimulationLoop } from './store/simulationStore';
import { useUiStore } from './store/uiStore';
import { loadInitialProject } from './store/bootstrap';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isEditable(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useProjectStore.getState().undo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        useProjectStore.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

// Diálogos poco frecuentes: se cargan bajo demanda.
const ShortcutsHelp = lazy(() => import('./ui/ShortcutsHelp').then((m) => ({ default: m.ShortcutsHelp })));
const AddToSceneDialog = lazy(() => import('./scenes/AddToSceneDialog').then((m) => ({ default: m.AddToSceneDialog })));

function LazyDialogs() {
  const help = useUiStore((s) => s.shortcutsOpen);
  const addToScene = useUiStore((s) => s.addToScene !== null);
  return (
    <Suspense fallback={null}>
      {help && <ShortcutsHelp />}
      {addToScene && <AddToSceneDialog />}
    </Suspense>
  );
}

export interface AppProps {
  /** Si es false no carga el proyecto inicial (tests). */
  autoLoad?: boolean;
}

export function App({ autoLoad = true }: AppProps) {
  useShortcuts();

  useEffect(() => {
    const stopSync = startSimulationSync();
    const stopAutoplay = startInteractAutoplay(
      (listener) => useUiStore.subscribe((s, prev) => listener(s.canvasMode, prev.canvasMode)),
      () => useUiStore.getState().notify('Modo Uso: la simulación se ha puesto en marcha para que avancen los temporizadores', 'info'),
    );
    let stopAutosave: (() => void) | undefined;
    let cancelled = false;
    const boot = autoLoad ? loadInitialProject() : Promise.resolve();
    void boot.then(() => {
      if (cancelled) return;
      useUiStore.getState().setActiveFloor(useProjectStore.getState().project.floors[0]?.id ?? null);
      stopAutosave = startAutosave();
    });
    return () => {
      cancelled = true;
      stopSync();
      stopAutoplay();
      stopAutosave?.();
      stopSimulationLoop();
    };
  }, [autoLoad]);

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col bg-slate-100 text-slate-800">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-72 shrink-0 border-r border-slate-200 md:block">
            <CatalogPanel />
          </div>
          <main className="relative flex min-w-0 flex-1 flex-col" aria-label="Plano">
            <FloorBar />
            <div className="min-h-0 flex-1">
              <Canvas />
            </div>
            <BottomPanel />
          </main>
          <div className="hidden w-80 shrink-0 border-l border-slate-200 lg:block">
            <PropertiesPanel />
          </div>
        </div>
        <Toast />
        <LazyDialogs />
      </div>
    </ReactFlowProvider>
  );
}
