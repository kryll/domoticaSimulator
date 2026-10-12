import { Suspense, lazy, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { TopBar } from './ui/TopBar';
import { BottomPanel } from './ui/BottomPanel';
import { Toast } from './ui/Toast';
import { CatalogPanel } from './catalog/CatalogPanel';
import { CenterArea } from './ui/CenterArea';
import { FloorBar } from './canvas/FloorBar';
import { FailureBanner } from './simulation/FailureBanner';
import { PropertiesPanel } from './canvas/PropertiesPanel';
import { useProjectStore } from './store/projectStore';
import { startAutosave } from './store/autosave';
import { startInteractAutoplay, startSimulationSync, stopSimulationLoop } from './store/simulationStore';
import { useUiStore } from './store/uiStore';
import { loadInitialProject } from './store/bootstrap';
import { ExtraDialogs } from './ui/ExtraDialogs';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { SaveConflictDialog, SaveErrorBanner } from './ui/SaveIndicator';

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
const ProjectSettingsDialog = lazy(() =>
  import('./settings/ProjectSettingsDialog').then((m) => ({ default: m.ProjectSettingsDialog })),
);
const VersionsDialog = lazy(() => import('./ui/VersionsDialog').then((m) => ({ default: m.VersionsDialog })));
const TemplateGallery = lazy(() => import('./automations/TemplateGallery').then((m) => ({ default: m.TemplateGallery })));

function LazyDialogs() {
  const help = useUiStore((s) => s.shortcutsOpen);
  const addToScene = useUiStore((s) => s.addToScene !== null);
  const settings = useUiStore((s) => s.settingsOpen);
  const templates = useUiStore((s) => s.templateGallery !== null);
  const versions = useUiStore((s) => s.versionsOpen);
  return (
    <Suspense fallback={null}>
      {help && <ShortcutsHelp />}
      {addToScene && <AddToSceneDialog />}
      {settings && <ProjectSettingsDialog />}
      {templates && <TemplateGallery />}
      {versions && <VersionsDialog />}
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
        <SaveErrorBanner />
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-72 shrink-0 border-r border-slate-200 md:block">
            <CatalogPanel />
          </div>
          <main className="relative flex min-w-0 flex-1 flex-col" aria-label="Plano">
            <FloorBar />
            <FailureBanner />
            <CenterArea />
            <BottomPanel />
          </main>
          <div className="hidden w-80 shrink-0 border-l border-slate-200 lg:block">
            <PropertiesPanel />
          </div>
        </div>
        <Toast />
        <LazyDialogs />
        <ExtraDialogs />
        <ConfirmDialog />
        <SaveConflictDialog />
      </div>
    </ReactFlowProvider>
  );
}
