import { BUTTON_ACTION_LABELS } from './labels';
import { useState } from 'react';
import type { EntityDefinition } from '../../types';
import { inputClass } from '../../ui/Field';
import { fmt, num } from './attrs';
import { CtlButton, Slider } from './primitives';
import type { ControlProps, SensorEvents } from './types';

const MOTION_CLASSES = new Set(['motion', 'occupancy', 'presence']);
const OPENING_CLASSES = new Set(['door', 'window', 'opening', 'garage_door']);

function binaryLabels(def: EntityDefinition): [string, string] {
  const dc = def.deviceClass ?? '';
  if (MOTION_CLASSES.has(dc)) return ['Movimiento', 'Sin movimiento'];
  if (OPENING_CLASSES.has(dc)) return ['Abrir', 'Cerrar'];
  if (dc === 'moisture') return ['Fuga de agua', 'Seco'];
  if (dc === 'smoke') return ['Humo detectado', 'Despejado'];
  return ['Activar', 'Desactivar'];
}

/** Rango razonable del deslizador según el tipo de sensor. */
function sensorRange(def: EntityDefinition, value: number): { min: number; max: number; step: number } {
  switch (def.deviceClass) {
    case 'temperature':
      return { min: -10, max: 45, step: 0.5 };
    case 'humidity':
    case 'battery':
    case 'moisture':
      return { min: 0, max: 100, step: 1 };
    case 'illuminance':
      return { min: 0, max: 2000, step: 10 };
    case 'carbon_dioxide':
      return { min: 400, max: 3000, step: 10 };
    case 'power':
      return { min: 0, max: 3500, step: 5 };
    case 'pressure':
      return { min: 950, max: 1050, step: 1 };
    default:
      return { min: 0, max: Math.max(100, Math.ceil(value * 2)), step: 1 };
  }
}

/** Botones de un binary_sensor: pulso de movimiento, abrir/cerrar, fuga... */
export function BinarySensorControl({ entityId, definition, state, events }: ControlProps & { events: SensorEvents }) {
  const [onLabel, offLabel] = binaryLabels(definition);
  const current = state?.state;
  const on = current === 'on' || current === true;
  const isMotion = MOTION_CLASSES.has(definition.deviceClass ?? '');
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={`Simular ${definition.name}`}>
      {isMotion && events.motionPulse && (
        <CtlButton
          variant="primary"
          onClick={() => events.motionPulse?.(entityId)}
          title="Movimiento con autoapagado según el modelo"
        >
          〰 Pulso de movimiento
        </CtlButton>
      )}
      <CtlButton pressed={on} onClick={() => events.setBinary?.(entityId, true)}>
        {onLabel}
      </CtlButton>
      <CtlButton pressed={!on} onClick={() => events.setBinary?.(entityId, false)}>
        {offLabel}
      </CtlButton>
    </div>
  );
}

/** Lectura numérica: deslizador y campo exacto. */
export function NumericSensorControl({ entityId, definition, state, events }: ControlProps & { events: SensorEvents }) {
  const value = num(state?.state, num(definition.initialState, 0));
  const range = sensorRange(definition, value);
  const [draft, setDraft] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(String(value));
  }
  const unit = definition.unit ? ` ${definition.unit}` : '';
  const apply = (n: number) => events.setValue?.(entityId, n);
  return (
    <div className="flex flex-col gap-1">
      <Slider
        label={definition.name}
        value={Math.min(range.max, Math.max(range.min, value))}
        min={range.min}
        max={range.max}
        step={range.step}
        format={(v) => `${fmt(v)}${unit}`}
        onCommit={apply}
      />
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(draft);
          if (Number.isFinite(n)) apply(n);
        }}
      >
        <input
          type="number"
          step="any"
          aria-label={`Nuevo valor de ${definition.name}`}
          className={`${inputClass} w-24`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {definition.unit && <span className="text-xs text-slate-500">{definition.unit}</span>}
        <CtlButton
          onClick={() => {
            const n = Number(draft);
            if (Number.isFinite(n)) apply(n);
          }}
        >
          Aplicar
        </CtlButton>
      </form>
    </div>
  );
}

/** Mando inalámbrico: un botón por cada acción del modelo. */
export function RemoteControl({ entityId, definition, events }: ControlProps & { events: SensorEvents }) {
  const actions = definition.capabilities?.buttonActions ?? ['single', 'double', 'hold'];
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label={`Acciones de ${definition.name}`}>
      {actions.map((a) => (
        <CtlButton key={a} onClick={() => events.press?.(entityId, a)}>
          {BUTTON_ACTION_LABELS[a] ?? a}
        </CtlButton>
      ))}
    </div>
  );
}
