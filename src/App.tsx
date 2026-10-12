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
import { useAutomationsWorkspaceOpen, useViewStore, welcomeDone } from './store/viewStore';
import { Tour } from './onboarding/Tour';
import { WelcomeDialog } from './onboarding/WelcomeDialog';
import { PresentationView } from './presentation/PresentationView';
import { hasSharedPresentation, openSharedPresentation } from './presentation/sharedPresentation';
import { SkipLinks } from './ui/SkipLinks';
import { TABLET_QUERY, useIsDesktop } from './ui/breakpoints';
import { useLayoutStore } from './store/layoutStore';
import { MobileDrawers } from './ui/MobileDrawers';
import { UpdatePrompt } from './pwa/UpdatePrompt';
import { Tanda3Dialogs } from './ui/Tanda3Dialogs';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || useViewStore.getState().presentation) return;
      const key = e.key.toLowerCase();
      // Ctrl/Cmd+K: búsqueda global (también desde un campo de texto).
      if (key === 'k' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const layout = useLayoutStore.getState();
        layout.setPaletteOpen(!layout.paletteOpen);
        return;
      }
      if (isEditable(e.target)) return;
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
const AutomationsWorkspace = lazy(() => import('./automations/AutomationsWorkspace').then((m) => ({ default: m.AutomationsWorkspace })));
const ProposalDialog = lazy(() => import('./proposal/ProposalDialog').then((m) => ({ default: m.ProposalDialog })));

function LazyDialogs() {
  const help = useUiStore((s) => s.shortcutsOpen);
  const addToScene = useUiStore((s) => s.addToScene !== null);
  const settings = useUiStore((s) => s.settingsOpen);
  const templates = useUiStore((s) => s.templateGallery !== null);
  const versions = useUiStore((s) => s.versionsOpen);
  const automations = useAutomationsWorkspaceOpen();
  const proposal = useViewStore((s) => s.proposalOpen);
  return (
    <Suspense fallback={null}>
      {help && <ShortcutsHelp />}
      {addToScene && <AddToSceneDialog />}
      {settings && <ProjectSettingsDialog />}
      {templates && <TemplateGallery />}
      {versions && <VersionsDialog />}
      {automations && <AutomationsWorkspace />}
      {proposal && <ProposalDialog />}
    </Suspense>
  );
}

export interface AppProps {
  /** Si es false no carga el proyecto inicial (tests). */
  autoLoad?: boolean;
}

/**
 * El editor de automatizaciones se abre por defecto en grande al entrar en su pestaña (salvo que
 * el usuario lo haya acoplado al panel inferior) y se cierra al cambiar de pestaña.
 */
function useAutomationsWorkspace() {
  useEffect(
    () =>
      useUiStore.subscribe((s, prev) => {
        const view = useViewStore.getState();
        const isAuto = s.bottomTab === 'automations' && s.bottomOpen;
        const wasAuto = prev.bottomTab === 'automations' && prev.bottomOpen;
        if (isAuto && !wasAuto && !view.automationsDocked && !view.presentation) view.setAutomationsModal(true);
        else if (!isAuto && wasAuto && view.automationsModal) view.setAutomationsModal(false);
      }),
    [],
  );
}

export function App({ autoLoad = true }: AppProps) {
  useShortcuts();
  useAutomationsWorkspace();
  const presentation = useViewStore((s) => s.presentation);
  const desktop = useIsDesktop();

  useEffect(() => {
    const stopSync = startSimulationSync();
    const stopAutoplay = startInteractAutoplay(
      (listener) => useUiStore.subscribe((s, prev) => listener(s.canvasMode, prev.canvasMode)),
      () => {
        // En el modo presentación ya se explica en su propia barra.
        if (!useViewStore.getState().presentation)
          useUiStore.getState().notify('Modo Uso: la simulación se ha puesto en marcha para que avancen los temporizadores', 'info');
      },
    );
    // En el móvil el panel inferior ocupa toda la pantalla: se empieza plegado para ver el plano.
    if (typeof window.matchMedia === 'function' && !window.matchMedia(TABLET_QUERY).matches) useUiStore.getState().setBottomOpen(false);
    let stopAutosave: (() => void) | undefined;
    let cancelled = false;
    const boot = autoLoad ? loadInitialProject() : Promise.resolve({ firstRun: false });
    void boot.then(async ({ firstRun }) => {
      if (cancelled) return;
      useUiStore.getState().setActiveFloor(useProjectStore.getState().project.floors[0]?.id ?? null);
      stopAutosave = startAutosave();
      if (autoLoad && hasSharedPresentation()) {
        await openSharedPresentation();
        return;
      }
      if (autoLoad && firstRun && !welcomeDone()) useViewStore.getState().setWelcomeOpen(true);
    });
    return () => {
      cancelled = true;
      stopSync();
      stopAutoplay();
      stopAutosave?.();
      stopSimulationLoop();
    };
  }, [autoLoad]);

  if (presentation) {
    return (
      <ReactFlowProvider>
        <PresentationView />
        <Toast />
        <UpdatePrompt />
        <Tanda3Dialogs />
        <LazyDialogs />
        <ConfirmDialog />
        <SaveConflictDialog />
      </ReactFlowProvider>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="flex h-full w-full flex-col overflow-hidden bg-slate-100 text-slate-800">
        <SkipLinks />
        <TopBar />
        <SaveErrorBanner />
        <div className="flex min-h-0 flex-1">
          {desktop && (
            <div className="w-72 shrink-0 border-r border-slate-200" data-tour="catalog">
              <CatalogPanel />
            </div>
          )}
          <main className="relative flex min-w-0 flex-1 flex-col" aria-label="Plano">
            <FloorBar />
            <FailureBanner />
            <CenterArea />
            <BottomPanel />
          </main>
          {desktop && (
            <div id="panel-propiedades" tabIndex={-1} className="w-80 shrink-0 border-l border-slate-200 focus:outline-none" data-tour="properties">
              <PropertiesPanel />
            </div>
          )}
        </div>
        {!desktop && <MobileDrawers />}
        <Toast />
        <LazyDialogs />
        <ExtraDialogs />
        <ConfirmDialog />
        <SaveConflictDialog />
        <WelcomeDialog />
        <Tour />
        <UpdatePrompt />
        <Tanda3Dialogs />
      </div>
    </ReactFlowProvider>
  );
}
