import { useUiStore } from '../store/uiStore';

/**
 * Ajustes de simulación (⚙): modelo térmico, temperatura exterior y latencia. Abre el diálogo
 * único «Ajustes del proyecto» en su pestaña «Simulación» (no hay un segundo panel de ajustes).
 */
export function SimulationSettingsButton() {
  return (
    <button
      type="button"
      aria-label="Ajustes de simulación"
      title="Ajustes de simulación (clima y latencia)"
      onClick={() => useUiStore.getState().setSettingsOpen(true, 'simulation')}
      className="rounded-md px-1.5 py-1 text-sm text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
    >
      ⚙
    </button>
  );
}
