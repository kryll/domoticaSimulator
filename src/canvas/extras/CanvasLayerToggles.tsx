import { useExtrasStore } from '../../store/extrasStore';
import { Button } from '../../ui/Button';
import { SuggestRouterButton } from './SuggestRouterButton';

/** Botones de las capas de la Fase 3 en la barra del lienzo. */
export function CanvasLayerToggles() {
  const showClimate = useExtrasStore((s) => s.showClimate);
  const showSignal = useExtrasStore((s) => s.showSignal);
  const toggleClimate = useExtrasStore((s) => s.toggleClimate);
  const toggleSignal = useExtrasStore((s) => s.toggleSignal);
  return (
    <>
      <Button size="sm" variant={showClimate ? 'primary' : 'ghost'} aria-pressed={showClimate} onClick={toggleClimate} title="Temperatura de cada sala">
        Clima
      </Button>
      <Button size="sm" variant={showSignal ? 'primary' : 'ghost'} aria-pressed={showSignal} onClick={toggleSignal} title="Mapa de calor de la señal (RSSI)">
        Señal
      </Button>
      <SuggestRouterButton />
    </>
  );
}
