import { useMemo, useState } from 'react';
import type { DayProfile } from '../types';
import { DAY_PROFILE_LABELS, eventsPerHour, generateDayPlan, planTime } from '../dayplan/dayplan';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useLayoutStore } from '../store/layoutStore';
import { useUiStore } from '../store/uiStore';
import { knownDefinitions } from '../canvas/analysis';
import { Modal } from '../ui/Modal';
import { useBridgeLive } from '../bridge/useBridge';
import { Button } from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import { countLabel } from '../ui/plural';
import { applyPlanNow, pendingPlanEvents, removePlanNow, DAY_PLAN_DAYS } from './dayPlanActions';

/** Histograma de eventos por hora (24 barras). */
function HourBars({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  const busiest = counts.indexOf(Math.max(...counts));
  return (
    <figure className="m-0">
      <div
        role="img"
        aria-label={`Eventos por hora: más actividad a las ${busiest}:00 (${counts[busiest] ?? 0} eventos)`}
        className="flex h-16 items-end gap-px rounded-md border border-slate-200 bg-slate-50 p-1"
      >
        {counts.map((c, h) => (
          <span key={h} title={`${h}:00 · ${c}`} className="flex-1 rounded-t bg-sky-500" style={{ height: `${Math.max(c > 0 ? 6 : 0, (c / max) * 100)}%` }} />
        ))}
      </div>
      <figcaption className="mt-0.5 flex justify-between text-[10px] text-slate-500" aria-hidden="true">
        <span>0 h</span>
        <span>6 h</span>
        <span>12 h</span>
        <span>18 h</span>
        <span>24 h</span>
      </figcaption>
    </figure>
  );
}

/**
 * «Generar día típico»: personas, perfil y semilla; vista previa de los eventos y Aplicar / Quitar.
 * Los eventos se programan en el motor y ocurren al avanzar el reloj.
 */
export function DayPlanDialog() {
  const close = () => useLayoutStore.getState().setDayPlanOpen(false);
  const project = useProjectStore((s) => s.project);
  const [people, setPeople] = useState(() => Math.max(1, Math.min(8, project.people?.length ?? 2)));
  const [profile, setProfile] = useState<DayProfile>('teletrabajo');
  const [seed, setSeed] = useState(1);
  const plan = useMemo(() => generateDayPlan(project, knownDefinitions(), { people, profile, seed }), [project, people, profile, seed]);
  const counts = useMemo(() => eventsPerHour(plan), [plan]);
  const active = useSimulationStore((s) => pendingPlanEvents(s.sim.pending) > 0);
  // E1: con el laboratorio en vivo los eventos los produce el entorno real: no hay día típico.
  const live = useBridgeLive();

  const apply = () => {
    if (!applyPlanNow(plan)) return;
    const ui = useUiStore.getState();
    ui.notify(`Día típico aplicado: ${countLabel(plan.events.length, 'evento', 'eventos')} al día durante ${DAY_PLAN_DAYS} días. Pulsa «Simular» (mejor a 600x).`, 'success', {
      action: { label: 'Quitar', run: removePlanNow },
    });
    close();
  };

  return (
    <Modal
      open
      size="lg"
      title="Generar día típico"
      onClose={close}
      footer={
        <>
          {active && (
            <Button
              variant="danger"
              onClick={() => {
                removePlanNow();
                useUiStore.getState().notify('Día típico quitado', 'info');
              }}
            >
              Quitar
            </Button>
          )}
          <Button onClick={close}>Cerrar</Button>
          <Button variant="primary" onClick={apply} disabled={plan.events.length === 0 || live}>
            Aplicar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-700">
          Genera la rutina de un día (despertarse, ducharse, cocinar, salir, volver, ver la tele…) a partir de las salas y los dispositivos del plano, para ver cómo
          responden tus automatizaciones.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <TextField label="Personas" type="number" min={1} max={8} value={people} onChange={(e) => setPeople(Math.max(1, Math.min(8, Number(e.target.value) || 1)))} />
          <SelectField
            label="Perfil"
            value={profile}
            options={(Object.keys(DAY_PROFILE_LABELS) as DayProfile[]).map((p) => ({ value: p, label: DAY_PROFILE_LABELS[p] }))}
            onChange={(e) => setProfile(e.target.value as DayProfile)}
          />
          <div className="flex items-end gap-1">
            <TextField label="Semilla" type="number" value={seed} onChange={(e) => setSeed(Math.trunc(Number(e.target.value) || 0))} fieldClassName="flex-1" />
            <Button onClick={() => setSeed(Math.floor(Math.random() * 100000))} aria-label="Semilla al azar" title="Otra semilla al azar">
              🎲
            </Button>
          </div>
        </div>
        {live && (
          <p role="alert" className="rounded-md bg-amber-50 px-2 py-1 text-sm text-amber-900">
            El laboratorio está en vivo: el día típico no se puede aplicar mientras tanto.
          </p>
        )}
        {active && (
          <p role="status" className="rounded-md bg-emerald-50 px-2 py-1 text-sm text-emerald-900">
            Hay un día típico activo. Al aplicar otro, sustituye al anterior.
          </p>
        )}
        <section aria-labelledby="dayplan-preview">
          <h3 id="dayplan-preview" className="mb-1 text-sm font-semibold text-slate-800">
            Vista previa: {countLabel(plan.events.length, 'evento', 'eventos')}
          </h3>
          {plan.events.length === 0 ? (
            <p className="text-sm text-slate-600">El plano no tiene salas ni dispositivos con los que generar eventos (movimiento, puertas, luces, TV…).</p>
          ) : (
            <>
              <HourBars counts={counts} />
              <ol aria-label="Eventos del día típico" className="mt-2 max-h-56 overflow-auto rounded-md border border-slate-200 text-sm">
                {plan.events.map((e, i) => (
                  <li key={i} className="flex gap-2 border-b border-slate-100 px-2 py-0.5 last:border-0">
                    <time className="shrink-0 font-mono text-xs tabular-nums text-slate-500">{planTime(e.at).slice(0, 5)}</time>
                    <span className="text-slate-800">{e.description}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}

