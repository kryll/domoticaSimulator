// «Sugerir router» (B21): calcula las propuestas de la planta y las muestra o las quita.
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { useExtrasStore } from '../../store/extrasStore';
import { catalog } from '../../devices/catalog';
import { suggestRouterPlacement } from '../../network/walls';

/** Activa o desactiva las marcas de routers sugeridos en la planta `floorId`. */
export function toggleRouterSuggestion(floorId: string | undefined): void {
  const store = useExtrasStore.getState();
  if (store.routerSuggestion && store.routerSuggestion.floorId === floorId) {
    store.setRouterSuggestion(null);
    return;
  }
  const project = useProjectStore.getState().project;
  const all = suggestRouterPlacement(project, catalog);
  const here = all.filter((s) => s.floorId === floorId);
  const ui = useUiStore.getState();
  if (!floorId || here.length === 0) {
    store.setRouterSuggestion(null);
    ui.notify(
      all.length > 0 ? `No hay propuestas en esta planta; hay ${all.length} en otras plantas.` : 'No hace falta ningún router: todos los dispositivos de malla tienen cobertura.',
      'info',
    );
    return;
  }
  store.setRouterSuggestion({ floorId, points: here.map((s) => ({ position: s.position, reason: s.reason })) });
  ui.notify(`${here.length === 1 ? 'Se propone 1 router' : `Se proponen ${here.length} routers`} (marcas 📶 en el plano)`, 'success', {
    details: here.map((s, i) => `${i + 1}. ${s.reason}`),
  });
}
