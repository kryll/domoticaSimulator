import { useEffect, useId, useRef, useState } from 'react';
import type { EnvironmentSettings, ReliabilitySettings } from '../types';
import { useProjectStore } from '../store/projectStore';
import { environmentSettings } from '../simulation/thermal';
import { TextField } from '../ui/Field';
import { parseNumberInput } from '../ui/formValues';

function updateEnvironment(patch: Partial<EnvironmentSettings>) {
  useProjectStore.getState().update((p) => ({ ...p, environment: { ...environmentSettings(p), ...patch } }));
}

function updateReliability(patch: Partial<ReliabilitySettings>) {
  useProjectStore.getState().update((p) => ({ ...p, reliability: { latency: false, ...p.reliability, ...patch } }));
}

/** Campo numérico que confirma al perder el foco o con Intro. */
function NumberField({ label, value, onCommit, step = 0.5, hint }: { label: string; value: number; onCommit: (v: number) => void; step?: number; hint?: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = parseNumberInput(draft);
    if (n === undefined) setDraft(String(value));
    else if (n !== value) onCommit(n);
  };
  return (
    <TextField
      label={label}
      type="number"
      step={step}
      value={draft}
      hint={hint}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

/** Ajustes de simulación (⚙): modelo térmico, temperatura exterior y latencia. */
export function SimulationSettingsButton() {
  const [open, setOpen] = useState(false);
  const env = useProjectStore((s) => s.project.environment);
  const reliability = useProjectStore((s) => s.project.reliability);
  const settings = environmentSettings({ environment: env });
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Ajustes de simulación"
        title="Ajustes de simulación"
        onClick={() => setOpen(!open)}
        className="rounded-md px-1.5 py-1 text-sm text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        ⚙
      </button>
      {open && (
        <div id={panelId} role="dialog" aria-label="Ajustes de simulación" className="absolute right-0 z-50 mt-1 flex w-72 flex-col gap-3 rounded-md border border-slate-200 bg-white p-3 shadow-lg">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Clima</legend>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={settings.enabled} onChange={(e) => updateEnvironment({ enabled: e.target.checked })} />
              Modelo térmico por sala
            </label>
            <NumberField
              label="Temperatura exterior media (°C)"
              value={settings.outdoorMean}
              onCommit={(v) => updateEnvironment({ outdoorMean: v })}
            />
            <NumberField
              label="Oscilación diaria (± °C)"
              value={settings.outdoorAmplitude}
              onCommit={(v) => updateEnvironment({ outdoorAmplitude: Math.max(0, v) })}
              hint="Máxima a las 15:00 y mínima a las 03:00."
            />
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Red</legend>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={reliability?.latency ?? false} onChange={(e) => updateReliability({ latency: e.target.checked })} />
              Latencia según protocolo e integración
            </label>
          </fieldset>
        </div>
      )}
    </div>
  );
}
