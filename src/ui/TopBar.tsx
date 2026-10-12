import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { knownDefinitions } from '../canvas/analysis';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { createDemoProject, createEmptyProject, exportProjectJson, importProjectJson } from '../store/persistence';
import { openAsNewProject, openProject } from '../store/bootstrap';
import { SimulationControls } from '../simulation/SimulationControls';
import { ScenariosMenu } from '../simulation/ScenariosMenu';
import { Button } from './Button';
import { ProjectsDialog } from './ProjectsDialog';
import { downloadText, readFileAsText, safeFilename } from './download';
import { useExtrasStore } from '../store/extrasStore';
import { TopBarExtras } from './TopBarExtras';
import { SaveIndicator } from './SaveIndicator';
import { useMediaQuery } from './useMediaQuery';
import { useSimulationStore } from '../store/simulationStore';
import { hasFailures } from './failures';
// Estático: yaml.ts ya va en el bundle principal (lo usa el motor a través de yamlLogic.ts).
import { automationsToYaml, scenesToYaml, scriptsToYaml } from '../export/yaml';
// También estáticos: los arreglos rápidos y el presupuesto ya los llevan al bundle principal.
import { billOfMaterials, bomToCsv } from '../export/bom';
import { devicesToCsv } from '../export/csv';
import { confirmDialog } from './confirm';
import { useViewStore } from '../store/viewStore';
import { enterPresentation } from '../presentation/presentationMode';
import { cx } from './cx';
import { LabHost } from '../bridge/LabHost';
import { useBridgeStore } from '../bridge/bridgeStore';
import { TABLET_QUERY } from './breakpoints';
import { useLayoutStore } from '../store/layoutStore';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}


function ProjectName({ compact = false }: { compact?: boolean }) {
  const name = useProjectStore((s) => s.project.name);
  const rename = useProjectStore((s) => s.renameProject);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const commit = () => {
    const v = draft.trim();
    if (v && v !== name) rename(v);
    else setDraft(name);
  };
  return (
    <input
      aria-label="Nombre del proyecto"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(name);
      }}
      className={`${compact ? 'w-0 min-w-[5rem] flex-1' : 'w-48'} rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-200`}
    />
  );
}

interface MenuProps {
  label: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  ariaLabel?: string;
}

/** Elementos del menú que pueden recibir el foco (en orden). */
function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
}

/**
 * Menú de la barra superior (patrón «menu button» de WAI-ARIA): role=menu, flechas, Inicio/Fin,
 * Escape cierra y devuelve el foco al botón, Tab cierra.
 */
export function Menu({ label, children, align = 'right', ariaLabel }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const focusOnOpen = useRef<'first' | 'last'>('first');

  useEffect(() => {
    if (!open) return;
    const items = menuItems(menuRef.current);
    (focusOnOpen.current === 'last' ? items[items.length - 1] : items[0])?.focus();
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const close = (focusButton = true) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(menuRef.current);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === 'Home') items[0]?.focus();
    else if (e.key === 'End') items[items.length - 1]?.focus();
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') {
      close(false);
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => {
          focusOnOpen.current = 'first';
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            focusOnOpen.current = e.key === 'ArrowUp' ? 'last' : 'first';
            setOpen(true);
          }
        }}
        className="flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
          onKeyDown={onMenuKey}
          className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} z-40 mt-1 flex max-h-[80vh] w-64 flex-col overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg`}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('[role="menuitem"]')) close(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function MenuHeader({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
      {children}
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      className="px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50 focus:bg-sky-50 focus:outline-none"
    >
      {children}
    </button>
  );
}

/** Barra superior: proyecto, archivo, exportación, deshacer y simulación. */
export function TopBar() {
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const notify = useUiStore((s) => s.notify);
  const [openDialog, setOpenDialog] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const base = () => safeFilename(useProjectStore.getState().project.name);
  const project = () => useProjectStore.getState().project;

  // Por debajo de 1440 px, Archivo, Exportar y Escenarios se agrupan en «☰ Proyecto».
  const wide = useMediaQuery('(min-width: 1440px)');
  const failing = useSimulationStore((st) => hasFailures(st.sim.failures));
  // Por debajo de 768 px: cabecera compacta en dos filas (proyecto y menús; simulación).
  const compact = !useMediaQuery(TABLET_QUERY);

  const safely = (fn: () => void | Promise<void>, ok?: string) => {
    Promise.resolve()
      .then(fn)
      .then(() => ok && notify(ok, 'success'))
      .catch((err: unknown) => notify(errorText(err), 'error'));
  };

  const fileItems = (
    <>
      <MenuItem
        onClick={async () => {
          const ok = await confirmDialog({
            title: '¿Crear un proyecto nuevo?',
            message: 'El actual queda guardado en el navegador.',
            confirmLabel: 'Crear proyecto',
          });
          if (ok) openProject(createEmptyProject('Nuevo proyecto'));
        }}
      >
        Nuevo proyecto
      </MenuItem>
      <MenuItem onClick={() => useExtrasStore.getState().openDialog('houseTemplates')}>Nuevo desde plantilla de casa…</MenuItem>
      <MenuItem onClick={() => setOpenDialog(true)}>Abrir…</MenuItem>
      <MenuItem onClick={() => useUiStore.getState().setVersionsOpen(true)}>Historial de versiones…</MenuItem>
      <MenuItem onClick={() => safely(() => openAsNewProject(createDemoProject()).then(() => undefined))}>Cargar proyecto de demo</MenuItem>
      <MenuItem onClick={() => fileRef.current?.click()}>Importar JSON…</MenuItem>
      <MenuItem onClick={() => useLayoutStore.getState().setImportHaOpen(true)}>Importar desde Home Assistant…</MenuItem>
      <MenuItem onClick={() => useExtrasStore.getState().openDialog('share')}>Compartir enlace…</MenuItem>
      <MenuItem onClick={() => enterPresentation()}>Modo presentación</MenuItem>
    </>
  );
  const exportItems = (
    <>
      <MenuItem onClick={() => safely(() => downloadText(exportProjectJson(project()), `${base()}.json`, 'application/json'))}>
        Proyecto (JSON)
      </MenuItem>
      <MenuItem onClick={() => safely(() => downloadText(automationsToYaml(project()), 'automations.yaml', 'text/yaml'))}>
        automations.yaml
      </MenuItem>
      <MenuItem onClick={() => safely(() => downloadText(scenesToYaml(project()), 'scenes.yaml', 'text/yaml'))}>
        scenes.yaml
      </MenuItem>
      <MenuItem onClick={() => safely(() => downloadText(scriptsToYaml(project()), 'scripts.yaml', 'text/yaml'))}>
        scripts.yaml
      </MenuItem>
      <MenuItem onClick={() => safely(() => downloadText(devicesToCsv(project(), knownDefinitions()), `${base()}-dispositivos.csv`, 'text/csv'))}>
        Inventario (CSV)
      </MenuItem>
      <MenuItem
        onClick={() =>
          safely(() => downloadText(bomToCsv(billOfMaterials(project(), knownDefinitions())), `${base()}-presupuesto.csv`, 'text/csv'))
        }
      >
        Presupuesto (CSV)
      </MenuItem>
      <MenuItem onClick={() => safely(async () => (await import('../export/png')).exportCanvasPng(`${base()}-plano.png`), 'Imagen exportada')}>
        Imagen del plano (PNG)
      </MenuItem>
      <MenuItem onClick={() => useViewStore.getState().setProposalOpen(true)}>Propuesta (PDF)…</MenuItem>
      <MenuItem onClick={() => useExtrasStore.getState().openDialog('packages')}>Configuración HA (packages .zip)…</MenuItem>
      {/* E1: laboratorio con un Home Assistant real (src/bridge). */}
      <MenuItem onClick={() => useBridgeStore.getState().setPanel(true)}>Laboratorio…</MenuItem>
    </>
  );

  return (
    <header
      className={cx(
        'flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5',
        compact ? 'flex-wrap gap-1 px-2' : 'flex-wrap gap-y-1 lg:flex-nowrap',
      )}
      data-compact={compact ? 'true' : undefined}
    >
      <h1 className={compact ? 'sr-only' : 'flex shrink-0 items-center gap-1.5 whitespace-nowrap text-base font-bold text-slate-800'}>
        <span aria-hidden="true">🏠</span>
        HA Simulator
      </h1>
      <ProjectName compact={compact} />
      <SaveIndicator />

      <nav className="flex items-center gap-1" aria-label="Menús del proyecto">
        {wide ? (
          <>
            <Menu label="Archivo">{fileItems}</Menu>
            <Menu label="Exportar">{exportItems}</Menu>
            <ScenariosMenu />
          </>
        ) : (
          <div className="relative">
            <Menu
              align="left"
              ariaLabel={failing ? 'Proyecto (fallos activos)' : 'Proyecto'}
              label={
                <>
                  <span aria-hidden="true">☰</span>
                  {!compact && ' Proyecto'}
                  {failing && <span className="h-2 w-2 rounded-full bg-red-600" aria-hidden="true" />}
                </>
              }
            >
              <MenuHeader>Archivo</MenuHeader>
              {fileItems}
              <MenuHeader>Exportar</MenuHeader>
              {exportItems}
              <MenuHeader>Escenarios</MenuHeader>
              <MenuItem onClick={() => useExtrasStore.getState().setScenariosOpen(true)}>
                Escenarios de fallo…{failing ? ' (activos)' : ''}
              </MenuItem>
            </Menu>
            <ScenariosMenu showTrigger={false} />
          </div>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => useUiStore.getState().setSettingsOpen(true)}
          title="Ajustes del proyecto y de la simulación"
          aria-label={compact ? 'Ajustes' : undefined}
        >
          <span aria-hidden="true">⚙</span>
          {!compact && ' Ajustes'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => useLayoutStore.getState().setPaletteOpen(true)}
          aria-label="Buscar"
          aria-keyshortcuts="Control+K Meta+K"
          title="Buscar dispositivos, automatizaciones y acciones (Ctrl+K)"
        >
          <span aria-hidden="true">🔍</span>
          {!compact && <kbd className="hidden font-mono text-[10px] text-slate-500 xl:inline">Ctrl K</kbd>}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Archivo JSON a importar"
          tabIndex={-1}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              const imported = await openAsNewProject(importProjectJson(await readFileAsText(file)));
              notify(`Proyecto «${imported.name}» importado`, 'success');
            } catch (err) {
              notify(`No se pudo importar: ${errorText(err)}`, 'error');
            }
          }}
        />
      </nav>

      <div className="flex items-center gap-1" role="group" aria-label="Historial">
        <Button size="sm" variant="ghost" onClick={undo} disabled={!canUndo} aria-label="Deshacer" title="Deshacer (Ctrl+Z)">
          ↶
        </Button>
        <Button size="sm" variant="ghost" onClick={redo} disabled={!canRedo} aria-label="Rehacer" title="Rehacer (Ctrl+Y)">
          ↷
        </Button>
      </div>

      <div className={cx('flex items-center gap-1', compact ? 'w-full justify-between' : 'ml-auto')}>
        <LabHost />
        <TopBarExtras />
        <SimulationControls />
      </div>
      {openDialog && <ProjectsDialog onClose={() => setOpenDialog(false)} />}
    </header>
  );
}
