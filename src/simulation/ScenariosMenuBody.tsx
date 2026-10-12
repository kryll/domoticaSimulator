import { useMemo, type ReactNode } from 'react';
import type { Failures } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { catalog } from '../devices/catalog';
import { ROLE_LABELS } from '../devices/labels';
import { definitionOf } from '../canvas/analysis';
import { FAILURE_SCENARIOS } from './scenarios';
import { NO_FAILURES, hasFailures } from '../ui/failures';
import { Button } from '../ui/Button';

/** Roles de infraestructura que se pueden «tirar» desde el menú. */
const DOWNABLE_ROLES = new Set(['coordinator', 'hub', 'border_router', 'access_point']);

function Toggle({ checked, onChange, children, hint }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm text-slate-700 hover:bg-slate-50">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
      />
      <span className="min-w-0 flex-1">
        {children}
        {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

export function ScenariosMenuBody({ onDone }: { onDone: () => void }) {
  const project = useProjectStore((s) => s.project);
  const failures = useSimulationStore((s) => s.sim.failures) ?? NO_FAILURES;
  const setFailures = useSimulationStore((s) => s.setFailures);
  const infra = useMemo(
    () =>
      project.devices
        .map((d) => ({ device: d, def: definitionOf(d) }))
        .filter((x) => x.def && DOWNABLE_ROLES.has(x.def.role)),
    [project],
  );
  const patch = (p: Partial<Failures>) => setFailures(p);
  const toggleDown = (id: string, down: boolean) =>
    patch({ devicesDown: down ? [...new Set([...failures.devicesDown, id])] : failures.devicesDown.filter((x) => x !== id) });

  return (
    <div className="flex flex-col gap-2">
      <section aria-label="Escenarios rápidos">
        <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Escenarios rápidos</h3>
        <div className="mt-1 flex flex-col gap-0.5">
          {FAILURE_SCENARIOS.map((sc) => (
            <button
              key={sc.id}
              type="button"
              title={sc.description}
              className="rounded px-1 py-1 text-left text-sm text-slate-700 hover:bg-slate-50 focus:bg-sky-50 focus:outline-none"
              onClick={() => {
                setFailures({ ...NO_FAILURES, ...sc.failures(project, catalog) });
                useUiStore.getState().setBottomTab('impact');
                onDone();
              }}
            >
              {sc.name}
              <span className="block text-[11px] text-slate-500">{sc.description}</span>
            </button>
          ))}
        </div>
      </section>
      <section aria-label="Fallos" className="border-t border-slate-200 pt-1">
        <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Fallos</h3>
        <Toggle checked={failures.internet} onChange={(v) => patch({ internet: v })} hint="Las integraciones en la nube dejan de responder">
          Sin Internet
        </Toggle>
        <Toggle checked={failures.powerOutage} onChange={(v) => patch({ powerOutage: v })} hint="Solo siguen los equipos a pilas o con SAI">
          Corte de luz
        </Toggle>
        <Toggle checked={failures.haRestarting} onChange={(v) => patch({ haRestarting: v })} hint="Ninguna automatización se ejecuta">
          Home Assistant reiniciando
        </Toggle>
      </section>
      <section aria-label="Coordinadores y hubs caídos" className="border-t border-slate-200 pt-1">
        <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Coordinadores y hubs caídos</h3>
        {infra.length === 0 ? (
          <p className="px-1 py-1 text-xs text-slate-500">El proyecto no tiene coordinadores ni hubs.</p>
        ) : (
          <div className="max-h-40 overflow-auto">
            {infra.map(({ device, def }) => (
              <Toggle
                key={device.id}
                checked={failures.devicesDown.includes(device.id)}
                onChange={(v) => toggleDown(device.id, v)}
                hint={def ? ROLE_LABELS[def.role] : undefined}
              >
                {device.name}
              </Toggle>
            ))}
          </div>
        )}
      </section>
      <div className="flex justify-between gap-2 border-t border-slate-200 pt-2">
        <Button size="sm" onClick={() => useUiStore.getState().setBottomTab('impact')}>
          Ver impacto
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!hasFailures(failures)}
          onClick={() => {
            setFailures(NO_FAILURES);
            onDone();
          }}
        >
          Restaurar todo
        </Button>
      </div>
    </div>
  );
}
