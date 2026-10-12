// Aplicar y quitar el «día típico» en la simulación (interfaz sobre src/dayplan).
import type { DayPlan } from '../types';
import { applyDayPlan, clearDayPlan, DAY_PLAN_KEY } from '../dayplan/dayplan';
import { DAY_MS } from '../simulation/clock';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { isBridgeLive } from '../bridge/useBridge';

/** Días que se programan al aplicar (el plan se repite cada día). */
export const DAY_PLAN_DAYS = 2;

/** Programa el plan (no con el laboratorio en vivo). Devuelve si se aplicó. */
export function applyPlanNow(plan: DayPlan): boolean {
  if (isBridgeLive()) return false;
  const project = useProjectStore.getState().project;
  useSimulationStore.setState((s) => ({ sim: applyDayPlan(s.sim, project, plan, s.sim.now, s.sim.now + DAY_PLAN_DAYS * DAY_MS) }));
  return true;
}

export function removePlanNow(): void {
  useSimulationStore.setState((s) => ({ sim: clearDayPlan(s.sim) }));
}

/** Eventos del día típico que quedan por ocurrir. */
export function pendingPlanEvents(pending: ReadonlyArray<{ key?: string }>): number {
  let n = 0;
  for (const p of pending) if (p.key?.startsWith(DAY_PLAN_KEY)) n++;
  return n;
}
