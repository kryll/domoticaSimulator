import type { Wall } from '../../types';
import { useProjectStore } from '../../store/projectStore';

/** Sustituye las paredes de una planta con un paso de deshacer. */
export function setFloorWalls(floorId: string, walls: Wall[]): void {
  useProjectStore.getState().update((p) => ({
    ...p,
    floors: p.floors.map((f) => (f.id === floorId ? { ...f, walls } : f)),
  }));
}
