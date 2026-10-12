import { useSimulationStore } from '../store/simulationStore';

/** Aviso «No disponible» con el botón para reconectar un dispositivo simulado sin conexión. */
export function OfflineNotice({ deviceId }: { deviceId: string }) {
  const setOffline = useSimulationStore((s) => s.setDeviceOffline);
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-dashed border-slate-400 bg-slate-100 px-2 py-2" role="status">
      <span className="text-sm font-semibold text-slate-600">No disponible</span>
      <button
        type="button"
        onClick={() => setOffline(deviceId, false)}
        className="rounded-md border border-sky-700 bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-1"
      >
        Reconectar
      </button>
    </div>
  );
}
