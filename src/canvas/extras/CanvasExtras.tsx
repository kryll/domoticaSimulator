import { Panel as FlowPanel } from '@xyflow/react';
import type { Floor, Room, Wall } from '../../types';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { useExtrasStore } from '../../store/extrasStore';
import { WallsLayer } from './WallsLayer';
import { WallDrawOverlay } from './WallDrawOverlay';
import { ClimateLayer, ClimateLegend } from './ClimateLayer';
import { SignalLayer, SignalLegend } from './SignalLayer';
import { RouterSuggestionsLayer } from './RouterSuggestionsLayer';

const NO_WALLS: Wall[] = [];

/**
 * Capas de la Fase 3 dentro del lienzo: paredes, clima, señal, routers sugeridos y el modo
 * «Dibujar pared». Cada capa se suscribe solo a lo que necesita.
 */
export function CanvasExtras({ floor, rooms }: { floor: Floor | undefined; rooms: Room[] }) {
  const mode = useUiStore((s) => s.canvasMode);
  const showClimate = useExtrasStore((s) => s.showClimate);
  const showSignal = useExtrasStore((s) => s.showSignal);
  const suggestion = useExtrasStore((s) => s.routerSuggestion);
  const project = useProjectStore((s) => s.project);
  if (!floor) return null;
  return (
    <>
      {showSignal && <SignalLayer project={project} floor={floor} />}
      <WallsLayer walls={floor.walls ?? NO_WALLS} />
      {showClimate && <ClimateLayer rooms={rooms} />}
      {suggestion && suggestion.floorId === floor.id && <RouterSuggestionsLayer points={suggestion.points} />}
      {(showClimate || showSignal) && (
        <FlowPanel position="bottom-right" className="!mb-2 flex flex-col items-end gap-1 md:!mb-[172px]">
          {showClimate && <ClimateLegend />}
          {showSignal && <SignalLegend project={project} floor={floor} />}
        </FlowPanel>
      )}
      {mode === 'wall' && <WallDrawOverlay floor={floor} />}
    </>
  );
}
