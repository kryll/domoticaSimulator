import { useMemo } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { catalog } from '../devices/catalog';
import { failureImpact } from '../simulation/scenarios';
import { NO_FAILURES, failureLabels, hasFailures } from '../ui/failures';
import { automationDeviceIds, revealDevice } from '../ui/entityDevices';
import { EmptyState } from '../ui/Panel';
import { Badge } from '../ui/Badge';
import { cx } from '../ui/cx';

type Status = 'ok' | 'degraded' | 'broken';

const STATUS: Record<Status, { label: string; icon: string; tone: 'green' | 'amber' | 'red' }> = {
  ok: { label: 'Funciona', icon: '✓', tone: 'green' },
  degraded: { label: 'Degradada', icon: '◐', tone: 'amber' },
  broken: { label: 'Rota', icon: '✗', tone: 'red' },
};

const RANK: Record<Status, number> = { broken: 0, degraded: 1, ok: 2 };

interface Row {
  id: string;
  name: string;
  status: Status;
  reasons: string[];
}

function StatusList({
  title,
  rows,
  onSelect,
  onOpen,
}: {
  title: string;
  rows: Row[];
  onSelect?: (id: string) => void;
  onOpen?: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={title}>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => {
          const st = STATUS[r.status];
          const body = (
            <>
              <Badge tone={st.tone}>
                <span aria-hidden="true">{st.icon} </span>
                {st.label}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-slate-800">{r.name}</span>
                {r.reasons.length > 0 && (
                  <span className="block text-xs text-slate-600">{r.reasons.join(' · ')}</span>
                )}
              </span>
            </>
          );
          return (
            <li key={r.id} data-status={r.status} className="flex items-stretch gap-1">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(r.id)}
                  className="flex w-full items-start gap-2 rounded-md border border-slate-200 px-2 py-1 text-left text-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  {body}
                </button>
              ) : (
                <div className="flex w-full items-start gap-2 rounded-md border border-slate-200 px-2 py-1 text-sm">{body}</div>
              )}
              {onOpen && (
                <button
                  type="button"
                  onClick={() => onOpen(r.id)}
                  aria-label={`Abrir ${r.name} en el editor`}
                  title="Abrir en el editor"
                  className="shrink-0 rounded-md border border-slate-200 px-2 text-xs text-sky-700 hover:bg-sky-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  Abrir ›
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Informe de impacto de los fallos activos: qué dispositivos caen y qué automatizaciones fallan. */
export function ImpactPanel() {
  const project = useProjectStore((s) => s.project);
  const failures = useSimulationStore((s) => s.sim.failures) ?? NO_FAILURES;
  const active = hasFailures(failures);
  const report = useMemo(() => (active ? failureImpact(project, catalog, failures) : null), [active, project, failures]);

  if (!active || !report) {
    return (
      <EmptyState>
        No hay fallos activos. Usa el menú «Escenarios» de la barra superior para simular la caída de Internet, un corte de
        luz, el reinicio de Home Assistant o la caída de un coordinador.
      </EmptyState>
    );
  }

  const deviceName = (id: string) => project.devices.find((d) => d.id === id)?.name ?? id;
  const byName = (a: Row, b: Row) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name, 'es');
  const automations: Row[] = report.automations
    .map((a) => ({
      id: a.automationId,
      name: project.automations.find((x) => x.id === a.automationId)?.name ?? a.automationId,
      status: a.status,
      reasons: a.reasons,
    }))
    .sort(byName);
  const scenes: Row[] = report.scenes
    .map((x) => ({ id: x.sceneId, name: project.scenes.find((s) => s.id === x.sceneId)?.name ?? x.sceneId, status: x.status, reasons: x.reasons }))
    .sort(byName);
  const scripts: Row[] = report.scripts
    .map((x) => ({ id: x.scriptId, name: project.scripts.find((s) => s.id === x.scriptId)?.name ?? x.scriptId, status: x.status, reasons: x.reasons }))
    .sort(byName);
  const broken = automations.filter((a) => a.status === 'broken').length;
  const degraded = automations.filter((a) => a.status === 'degraded').length;

  const focusDevice = (id: string) => revealDevice(project, id, useUiStore.getState());
  const selectAutomation = (id: string) => {
    const ui = useUiStore.getState();
    const ids = automationDeviceIds(project, id);
    ui.selectAutomation(id);
    if (ids.length > 0) {
      const first = project.devices.find((d) => d.id === ids[0]);
      if (first && ui.activeFloorId !== first.floorId) ui.setActiveFloor(first.floorId);
      ui.focusDevices(ids);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-3">
      <p className="text-sm text-slate-700" role="status">
        <strong>{failureLabels(failures, deviceName).join(' · ')}</strong>: {report.unavailableDevices.length} dispositivos no
        disponibles, {broken} automatizaciones rotas y {degraded} degradadas.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-label="Dispositivos no disponibles">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Dispositivos no disponibles</h3>
          {report.unavailableDevices.length === 0 ? (
            <p className="text-xs text-slate-500">Todos los dispositivos siguen disponibles.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {report.unavailableDevices.map((d) => (
                <li key={d.deviceId}>
                  <button
                    type="button"
                    onClick={() => focusDevice(d.deviceId)}
                    className={cx(
                      'flex w-full items-start gap-2 rounded-md border border-slate-200 px-2 py-1 text-left text-sm',
                      'hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
                    )}
                  >
                    <span aria-hidden="true">⛔</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-slate-800">{deviceName(d.deviceId)}</span>
                      <span className="block text-xs text-slate-600">{d.reason}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="flex flex-col gap-4">
          {automations.length === 0 ? (
            <p className="text-xs text-slate-500">El proyecto no tiene automatizaciones.</p>
          ) : (
            <StatusList
              title="Automatizaciones"
              rows={automations}
              onSelect={selectAutomation}
              onOpen={(id) => useUiStore.getState().showAutomation(id)}
            />
          )}
          <StatusList title="Escenas" rows={scenes} />
          <StatusList title="Scripts" rows={scripts} />
        </div>
      </div>
    </div>
  );
}
