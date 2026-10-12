import { HVAC_LABELS, PRESET_LABELS } from './labels';
import { withDefaults } from '../../devices/capabilities';
import { attr, fmt, num } from './attrs';
import { Segmented, Stepper } from './primitives';
import type { ControlProps } from './types';



/** Termostato: consigna, modo HVAC y preset. */
export function ClimateControl({ definition, state, onService }: ControlProps) {
  const caps = withDefaults('climate', definition.capabilities);
  const step = caps.tempStep ?? 0.5;
  const target = num(attr(state, 'temperature'), 21);
  const current = attr(state, 'current_temperature');
  const mode = typeof state?.state === 'string' ? state.state : undefined;
  const preset = attr(state, 'preset_mode');
  return (
    <div className="flex flex-col gap-2">
      {current !== undefined && (
        <p className="text-xs text-slate-600">
          Temperatura actual: <strong className="tabular-nums">{fmt(num(current, 0))} °C</strong>
        </p>
      )}
      <Stepper
        label="Consigna"
        value={target}
        step={step}
        min={caps.minTemp ?? 7}
        max={caps.maxTemp ?? 35}
        format={(v) => `${fmt(v)} °C`}
        onChange={(v) => onService('set_temperature', { temperature: v })}
      />
      <Segmented
        label="Modo"
        value={mode}
        options={(caps.hvacModes ?? ['off', 'heat']).map((m) => ({ value: m, label: HVAC_LABELS[m] ?? m }))}
        onChange={(m) => onService('set_hvac_mode', { hvac_mode: m })}
      />
      {caps.presetModes && caps.presetModes.length > 0 && (
        <Segmented
          label="Preset"
          value={typeof preset === 'string' ? preset : undefined}
          options={caps.presetModes.map((p) => ({ value: p, label: PRESET_LABELS[p] ?? p }))}
          onChange={(p) => onService('set_preset_mode', { preset_mode: p })}
        />
      )}
    </div>
  );
}
