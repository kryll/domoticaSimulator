// Cambios del proyecto que renombran entidades (mostrar como luz, renombrar grupos o personas):
// la simulación traslada estados, temporizadores e historial al nuevo entity_id y el proyecto
// se actualiza en un único paso de deshacer.
import type { Project } from '../types';
import { renameEntities } from '../simulation/engine';
import { useProjectStore } from './projectStore';
import { useSimulationStore } from './simulationStore';

export function updateWithRename(mapping: Record<string, string>, mutator: (p: Project) => Project): void {
  if (Object.keys(mapping).length > 0) useSimulationStore.setState((s) => ({ sim: renameEntities(s.sim, mapping) }));
  useProjectStore.getState().update(mutator);
}
