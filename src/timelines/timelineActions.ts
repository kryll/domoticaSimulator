import type { Timeline } from '../types';
import { useProjectStore } from '../store/projectStore';
import { newId } from '../ui/ids';

export function updateTimeline(id: string, patch: Partial<Omit<Timeline, 'id'>>): void {
  useProjectStore.getState().update((p) => ({
    ...p,
    timelines: (p.timelines ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)),
  }));
}

export function addTimeline(timeline?: Partial<Omit<Timeline, 'id'>>): Timeline {
  const count = useProjectStore.getState().project.timelines?.length ?? 0;
  const created: Timeline = { name: `Prueba ${count + 1}`, steps: [], ...timeline, id: newId('timeline') };
  useProjectStore.getState().update((p) => ({ ...p, timelines: [...(p.timelines ?? []), created] }));
  return created;
}
