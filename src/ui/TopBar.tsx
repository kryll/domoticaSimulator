import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { createDemoProject, createEmptyProject, exportProjectJson, importProjectJson } from '../store/persistence';
import { openAsNewProject, openProject } from '../store/bootstrap';
import { catalog } from '../devices/catalog';
import { SimulationControls } from '../simulation/SimulationControls';
import { Button } from './Button';
import { ProjectsDialog } from './ProjectsDialog';
import { downloadText, readFileAsText, safeFilename } from './download';

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}


function ProjectName() {
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
      className="w-48 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-slate-800 hover:border-slate-300 focus:border-sky-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
    />
  );
}

function SaveStatus() {
  const dirty = useProjectStore((s) => s.dirty);
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt);
  return (
    <span className="hidden text-[11px] text-slate-400 xl:inline" aria-live="polite">
      {dirty ? 'Guardando…' : lastSavedAt ? 'Guardado' : ''}
    </span>
  );
}

function Menu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  return (
    <details ref={ref} className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
        {label} ▾
      </summary>
      <div
        className="absolute right-0 z-40 mt-1 flex w-56 flex-col rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        onClick={() => {
          if (ref.current) ref.current.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
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

  const safely = (fn: () => void | Promise<void>, ok?: string) => {
    Promise.resolve()
      .then(fn)
      .then(() => ok && notify(ok, 'success'))
      .catch((err: unknown) => notify(errorText(err), 'error'));
  };

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-1.5">
      <h1 className="mr-1 flex items-center gap-1.5 text-base font-bold text-slate-800">
        <span aria-hidden="true">🏠</span>HA Simulator
      </h1>
      <ProjectName />
      <SaveStatus />

      <nav className="flex items-center gap-1" aria-label="Archivo">
        <Menu label="Archivo">
          <MenuItem
            onClick={() => {
              if (window.confirm('¿Crear un proyecto nuevo? El actual queda guardado en el navegador.'))
                openProject(createEmptyProject('Nuevo proyecto'));
            }}
          >
            Nuevo proyecto
          </MenuItem>
          <MenuItem onClick={() => setOpenDialog(true)}>Abrir…</MenuItem>
          <MenuItem onClick={() => safely(() => openAsNewProject(createDemoProject()).then(() => undefined))}>Cargar proyecto de demo</MenuItem>
          <MenuItem onClick={() => fileRef.current?.click()}>Importar JSON…</MenuItem>
        </Menu>
        <Menu label="Exportar">
          <MenuItem onClick={() => safely(() => downloadText(exportProjectJson(project()), `${base()}.json`, 'application/json'))}>
            Proyecto (JSON)
          </MenuItem>
          <MenuItem onClick={() => safely(async () => downloadText((await import('../export/yaml')).automationsToYaml(project()), 'automations.yaml', 'text/yaml'))}>
            automations.yaml
          </MenuItem>
          <MenuItem onClick={() => safely(async () => downloadText((await import('../export/yaml')).scenesToYaml(project()), 'scenes.yaml', 'text/yaml'))}>
            scenes.yaml
          </MenuItem>
          <MenuItem onClick={() => safely(async () => downloadText((await import('../export/yaml')).scriptsToYaml(project()), 'scripts.yaml', 'text/yaml'))}>
            scripts.yaml
          </MenuItem>
          <MenuItem onClick={() => safely(async () => downloadText((await import('../export/csv')).devicesToCsv(project(), catalog), `${base()}-dispositivos.csv`, 'text/csv'))}>
            Inventario (CSV)
          </MenuItem>
          <MenuItem onClick={() => safely(async () => (await import('../export/png')).exportCanvasPng(`${base()}-plano.png`), 'Imagen exportada')}>
            Imagen del plano (PNG)
          </MenuItem>
        </Menu>
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

      <div className="ml-auto">
        <SimulationControls />
      </div>
      {openDialog && <ProjectsDialog onClose={() => setOpenDialog(false)} />}
    </header>
  );
}
