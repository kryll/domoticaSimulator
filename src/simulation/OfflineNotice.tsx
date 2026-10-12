import { useId } from 'react';
import { knownDefinitions } from '../canvas/analysis';
import { useSimulationStore } from '../store/simulationStore';
import { useProjectStore } from '../store/projectStore';
import { offlineBlockReason } from './availability';

/** Motivo por el que no se puede reconectar el dispositivo (null si se puede). */
function useOfflineBlockReason(deviceId: string): string | null {
  const project = useProjectStore((s) => s.project);
  return useSimulationStore((s) => offlineBlockReason(s.sim, project, knownDefinitions(), deviceId));
}

/** Aviso «No disponible» con el botón para reconectar un dispositivo simulado sin conexión. */
export function OfflineNotice({ deviceId }: { deviceId: string }) {
  const setOffline = useSimulationStore((s) => s.setDeviceOffline);
  const blocked = useOfflineBlockReason(deviceId);
  const reasonId = useId();
  return (
    <div className="flex flex-col gap-1 rounded-md border border-dashed border-slate-400 bg-slate-100 px-2 py-2" role="status">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-slate-600">No disponible</span>
        <button
          type="button"
          onClick={() => setOffline(deviceId, false)}
          disabled={blocked !== null}
          aria-describedby={blocked ? reasonId : undefined}
          className="rounded-md border border-sky-700 bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300 disabled:text-slate-600"
        >
          Reconectar
        </button>
      </div>
      {blocked && (
        <span id={reasonId} className="text-xs text-slate-600" data-testid="offline-block-reason">
          {blocked}
        </span>
      )}
    </div>
  );
}
