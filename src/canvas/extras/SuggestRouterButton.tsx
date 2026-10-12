import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { useExtrasStore } from '../../store/extrasStore';
import { catalog } from '../../devices/catalog';
import { suggestRouterPlacement } from '../../network/walls';
import { Button } from '../../ui/Button';

/** «Sugerir router»: marca dónde poner un router de malla para los dispositivos sin cobertura (B21). */
export function SuggestRouterButton() {
  const activeFloorId = useUiStore((s) => s.activeFloorId);
  const suggestion = useExtrasStore((s) => s.routerSuggestion);
  const floors = useProjectStore((s) => s.project.floors);
  const floorId = activeFloorId ?? floors[0]?.id;
  const active = suggestion !== null && suggestion.floorId === floorId;

  const run = () => {
    const store = useExtrasStore.getState();
    if (active) {
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
  };

  return (
    <Button size="sm" variant={active ? 'primary' : 'ghost'} aria-pressed={active} onClick={run} title="Propone dónde poner un router Zigbee, Thread o Z-Wave">
      Sugerir router
    </Button>
  );
}
