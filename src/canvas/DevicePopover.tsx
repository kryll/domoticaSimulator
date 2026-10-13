import { useEffect, useMemo, useRef, type SyntheticEvent } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { EntityControls } from '../simulation/EntityControls';
import { OfflineNotice } from '../simulation/OfflineNotice';
import { useDeviceOffline } from '../simulation/useDeviceOffline';
import { definitionOf, entitiesOfDevice } from './analysis';
import { VacuumPanel } from '../simulation/controls/VacuumPanel';
import { AssistPanel } from '../simulation/controls/AssistPanel';
import { entityStateText } from '../ui/stateText';

/** Dominios de diagnóstico que se muestran al final y plegados. */
const DIAGNOSTIC_KEYS = new Set(['battery', 'linkquality', 'rssi', 'signal_strength', 'voltage']);

function stop(e: SyntheticEvent) {
  e.stopPropagation();
}

/**
 * Control completo de un dispositivo, anclado al nodo con NodeToolbar. Los eventos no se
 * propagan al nodo (el portal de React los haría llegar a React Flow).
 */
export function DevicePopover({ deviceId }: { deviceId: string }) {
  const device = useProjectStore((s) => s.project.devices.find((d) => d.id === deviceId));
  const entities = useSimulationStore((s) => s.sim.entities);
  const close = () => useUiStore.getState().openPopover(null);
  const ref = useRef<HTMLDivElement>(null);
  const offline = useDeviceOffline(deviceId);
  const refs = useMemo(() => (device ? entitiesOfDevice(device) : []), [device]);
  const def = device ? definitionOf(device) : undefined;
  const isVacuum = def?.category === 'vacuum' && refs.some((r) => r.definition.domain === 'vacuum');
  // El robot tiene su panel propio: sus entidades sueltas van plegadas con el diagnóstico.
  const main = isVacuum ? [] : refs.filter((r) => !DIAGNOSTIC_KEYS.has(r.definition.key) && !DIAGNOSTIC_KEYS.has(r.definition.deviceClass ?? ''));
  const diag = refs.filter((r) => !main.includes(r));

  useEffect(() => {
    const first =
      ref.current?.querySelector<HTMLElement>('ul button, ul input, ul select') ??
      ref.current?.querySelector<HTMLElement>('button');
    first?.focus({ preventScroll: true });
  }, []);

  if (!device) return null;
  const single = refs.length === 1;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Control de ${device.name}`}
      className="nodrag nopan nowheel w-80 max-h-[85vh] overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xl"
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onPointerDown={stop}
      onMouseDown={stop}
      onWheel={stop}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') close();
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="truncate text-sm font-semibold text-slate-800">{device.name}</h2>
        <button
          type="button"
          onClick={close}
          aria-label="Cerrar control"
          className="rounded px-1.5 text-sm text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
        >
          ✕
        </button>
      </div>
      {/* El altavoz sigue oyendo aunque HA lo vea no disponible (sin Internet responde que no puede). */}
      {def?.assistant && (
        <div className="mb-2">
          <AssistPanel device={device} def={def} />
        </div>
      )}
      {offline ? (
        <OfflineNotice deviceId={deviceId} />
      ) : (
        <>
          {refs.length === 0 && <p className="text-xs text-slate-500">Este dispositivo no expone entidades.</p>}
          {isVacuum && def && <VacuumPanel device={device} def={def} />}

          <ul className="flex max-h-[60vh] flex-col gap-3 overflow-auto">
            {main.map((r) => (
              <li key={r.entityId}>
                {!single && (
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-slate-700" title={r.entityId}>
                      {r.definition.name}
                    </span>
                    <span className="text-xs tabular-nums text-slate-500">
                      {entityStateText(r.entityId, entities[r.entityId], r.definition)}
                    </span>
                  </div>
                )}
                <EntityControls entityId={r.entityId} definition={r.definition} state={entities[r.entityId]} />
              </li>
            ))}
          </ul>
          {diag.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-slate-500">{isVacuum ? 'Entidades' : 'Diagnóstico'}</summary>
              <ul className="mt-1 flex flex-col gap-2">
                {diag.map((r) => (
                  <li key={r.entityId}>
                    <div className="mb-0.5 flex justify-between text-slate-600">
                      <span>{r.definition.name}</span>
                      <span className="tabular-nums">{entityStateText(r.entityId, entities[r.entityId], r.definition)}</span>
                    </div>
                    <EntityControls entityId={r.entityId} definition={r.definition} state={entities[r.entityId]} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
