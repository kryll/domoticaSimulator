import { useEffect, useMemo, useState } from 'react';
import type { Automation, AutomationTrace, TraceCondition } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { formatSimDate, formatSimTime } from '../simulation/clock';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/Panel';
import { cx } from '../ui/cx';
import { automationDeviceIds } from '../ui/entityDevices';
import { ACTION_STATUS, TRACE_RESULT, traceTriggerText } from '../ui/traceLabels';

const EMPTY: AutomationTrace[] = [];

/** Condiciones evaluadas en árbol: las anidadas (Y/O) cuelgan de su grupo. */
function ConditionTree({ items, label, nested = false }: { items: TraceCondition[]; label: string; nested?: boolean }) {
  return (
    <ol className={cx('flex flex-col gap-1', nested ? 'ml-5 mt-1 border-l-2 border-slate-200 pl-2' : 'mt-0.5')} aria-label={label}>
      {items.map((c) => (
        <li key={c.index}>
          <div
            className={cx(
              'flex items-start gap-2 rounded-md border px-2 py-1',
              c.result ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50',
            )}
          >
            <span className={cx('font-bold', c.result ? 'text-emerald-700' : 'text-red-700')} role="img" aria-label={c.result ? 'Se cumple' : 'No se cumple'}>
              {c.result ? '✓' : '✗'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-slate-800">{c.description}</span>
              {c.detail && <span className="block text-xs text-slate-600">{c.detail}</span>}
            </span>
          </div>
          {c.children && c.children.length > 0 && <ConditionTree items={c.children} label={`Dentro de: ${c.description}`} nested />}
        </li>
      ))}
    </ol>
  );
}

function TraceDetail({ trace }: { trace: AutomationTrace }) {
  const result = TRACE_RESULT[trace.result];
  return (
    <div className="flex flex-col gap-3 text-sm" aria-label="Detalle de la traza">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-600">
          {formatSimDate(trace.startedAt)} {formatSimTime(trace.startedAt, { seconds: true })}
        </span>
        <Badge tone={result.tone}>
          {result.icon} {result.label}
        </Badge>
      </div>
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Disparador</h4>
        <p className="mt-0.5 rounded-md bg-slate-50 px-2 py-1 text-slate-800">⚡ {traceTriggerText(trace)}</p>
      </section>
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Condiciones</h4>
        {trace.conditions.length === 0 ? (
          <p className="mt-0.5 text-xs text-slate-500">Sin condiciones evaluadas.</p>
        ) : (
          <ConditionTree items={trace.conditions} label="Condiciones evaluadas" />
        )}
      </section>
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Acciones</h4>
        {trace.actions.length === 0 ? (
          <p className="mt-0.5 text-xs text-slate-500">No se ejecutó ninguna acción.</p>
        ) : (
          <ol className="mt-0.5 flex flex-col gap-1" aria-label="Acciones">
            {trace.actions.map((a) => {
              const st = ACTION_STATUS[a.status];
              return (
                <li key={a.index} className="flex items-start gap-2 rounded-md border border-slate-200 px-2 py-1">
                  <span className={cx('font-bold', st.className)} role="img" aria-label={st.label}>
                    {st.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-slate-800">{a.description}</span>
                    <span className="block text-xs text-slate-600">
                      {st.label}
                      {/* En las esperas la hora ya va en el detalle («hasta las …»). */}
                      {a.at !== undefined && a.status !== 'waiting' && ` · ${formatSimTime(a.at, { seconds: true })}`}
                      {a.detail && ` · ${a.detail}`}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

/** Pestaña «Trazas»: ejecuciones de la automatización y su detalle paso a paso. */
export function TracesView({ automation }: { automation: Automation }) {
  const all = useSimulationStore((s) => s.sim.traces ?? EMPTY);
  const traces = useMemo(
    () => all
        .filter((t) => t.automationId === automation.id)
        .reverse()
        .sort((a, b) => b.startedAt - a.startedAt),
    [all, automation.id],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = traces.find((t) => t.id === selectedId) ?? traces[0];
  const project = useProjectStore((s) => s.project);
  const deviceIds = useMemo(() => automationDeviceIds(project, automation.id), [project, automation.id]);
  const deviceKey = deviceIds.join('|');

  // Resalta en el lienzo los dispositivos implicados mientras se ve una traza (no depende del reloj).
  const selectedKey = selected?.id;
  useEffect(() => {
    if (!selectedKey) return;
    useUiStore.getState().setHighlighted(deviceKey ? deviceKey.split('|') : []);
  }, [selectedKey, deviceKey]);
  useEffect(() => () => useUiStore.getState().setHighlighted([]), []);

  const run = () => {
    useSimulationStore.getState().runAutomation(automation.id, true);
    useUiStore.getState().notify(`Acciones de «${automation.name}» ejecutadas`, 'success');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Probar la automatización">
        <Button size="sm" variant="primary" onClick={run} title="Ejecuta las acciones sin comprobar las condiciones">
          ▶ Ejecutar acciones
        </Button>
        {automation.triggers.map((_, i) => (
          <Button
            key={i}
            size="sm"
            onClick={() => useSimulationStore.getState().testTrigger(automation.id, i)}
            title="Simula que se cumple este disparador: se evalúan las condiciones"
          >
            ⚡ Probar disparador {i + 1}
          </Button>
        ))}
      </div>
      {traces.length === 0 ? (
        <EmptyState>Aún no hay ejecuciones de esta automatización.</EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[14rem,1fr]">
          <ul className="flex max-h-72 flex-col overflow-auto rounded-md border border-slate-200" aria-label="Ejecuciones">
            {traces.map((t) => {
              const r = TRACE_RESULT[t.result];
              const isSel = selected?.id === t.id;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    aria-current={isSel ? 'true' : undefined}
                    onClick={() => setSelectedId(t.id)}
                    className={cx(
                      'flex w-full items-center gap-2 px-2 py-1 text-left text-xs',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500',
                      isSel ? 'bg-sky-50 text-sky-900' : 'hover:bg-slate-50',
                    )}
                  >
                    <span aria-hidden="true">{r.icon}</span>
                    <span className="font-mono">{formatSimTime(t.startedAt, { seconds: true })}</span>
                    <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected && <TraceDetail trace={selected} />}
        </div>
      )}
    </div>
  );
}
