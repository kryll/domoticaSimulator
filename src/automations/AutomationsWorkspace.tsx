import { useEffect, useRef } from 'react';
import { useUiStore } from '../store/uiStore';
import { useAutomationsWorkspaceOpen, useViewStore } from '../store/viewStore';
import { Button } from '../ui/Button';
import { trapTab } from '../ui/focusTrap';
import { AutomationsPanel } from './AutomationsPanel';

/**
 * Editor de automatizaciones en grande: diálogo casi a pantalla completa con la lista a la
 * izquierda y el editor a la derecha. Deja libre una franja inferior para los avisos flotantes.
 */
export function AutomationsWorkspace() {
  const open = useAutomationsWorkspaceOpen();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus?.();
  }, [open]);

  if (!open) return null;
  const close = () => useViewStore.getState().setAutomationsModal(false);

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/40" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="automations-workspace-title"
        tabIndex={-1}
        onKeyDown={(e) => {
          // Escape cierra si no lo ha usado antes un control interno (combobox, menú…).
          const ownDialog = (e.target as HTMLElement).closest('[role="dialog"]') === ref.current;
          if (e.key === 'Escape' && !e.defaultPrevented && ownDialog) {
            e.preventDefault();
            close();
          } else if (ownDialog) trapTab(e, ref.current);
        }}
        className="absolute inset-x-2 bottom-20 top-2 flex flex-col overflow-hidden rounded-lg bg-white shadow-2xl focus:outline-none sm:inset-x-4 sm:top-4"
      >
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
          <h2 id="automations-workspace-title" className="text-base font-semibold text-slate-900">
            Automatizaciones
          </h2>
          <span className="ml-auto" />
          <Button
            size="sm"
            variant="ghost"
            title="Editar en el panel inferior (se recuerda)"
            onClick={() => {
              useViewStore.getState().setAutomationsDocked(true);
              useUiStore.getState().setBottomTab('automations');
            }}
          >
            Acoplar al panel inferior
          </Button>
          <Button size="sm" variant="ghost" onClick={close} aria-label="Cerrar el editor de automatizaciones">
            ✕
          </Button>
        </header>
        <div className="min-h-0 flex-1">
          <AutomationsPanel layout="workspace" />
        </div>
      </div>
    </div>
  );
}
