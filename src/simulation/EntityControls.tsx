import { useState } from 'react';
import type { EntityDefinition, EntityState, EntityStateValue } from '../types';
import { useSimulationStore } from '../store/simulationStore';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/Field';

interface QuickAction {
  label: string;
  state: EntityStateValue;
}

function quickActions(def: EntityDefinition): QuickAction[] {
  switch (def.domain) {
    case 'light':
    case 'switch':
    case 'fan':
      return [
        { label: 'Encender', state: 'on' },
        { label: 'Apagar', state: 'off' },
      ];
    case 'binary_sensor':
      switch (def.deviceClass) {
        case 'motion':
        case 'occupancy':
        case 'presence':
          return [
            { label: 'Movimiento', state: 'on' },
            { label: 'Sin movimiento', state: 'off' },
          ];
        case 'door':
        case 'window':
        case 'opening':
        case 'garage_door':
          return [
            { label: 'Abrir', state: 'on' },
            { label: 'Cerrar', state: 'off' },
          ];
        case 'moisture':
          return [
            { label: 'Fuga de agua', state: 'on' },
            { label: 'Seco', state: 'off' },
          ];
        case 'smoke':
          return [
            { label: 'Humo detectado', state: 'on' },
            { label: 'Despejado', state: 'off' },
          ];
        default:
          return [
            { label: 'Activar', state: 'on' },
            { label: 'Desactivar', state: 'off' },
          ];
      }
    case 'cover':
      return [
        { label: 'Abrir', state: 'open' },
        { label: 'Cerrar', state: 'closed' },
      ];
    case 'lock':
      return [
        { label: 'Bloquear', state: 'locked' },
        { label: 'Desbloquear', state: 'unlocked' },
      ];
    case 'media_player':
      return [
        { label: 'Reproducir', state: 'playing' },
        { label: 'Pausa', state: 'paused' },
        { label: 'Apagar', state: 'off' },
      ];
    case 'vacuum':
      return [
        { label: 'Limpiar', state: 'cleaning' },
        { label: 'A la base', state: 'docked' },
      ];
    case 'camera':
      return [
        { label: 'Grabar', state: 'recording' },
        { label: 'En reposo', state: 'idle' },
      ];
    case 'climate':
      return [
        { label: 'Calefacción', state: 'heat' },
        { label: 'Frío', state: 'cool' },
        { label: 'Apagar', state: 'off' },
      ];
    default:
      return [];
  }
}

function NumberSetter({
  label,
  initial,
  unit,
  onApply,
}: {
  label: string;
  initial: number;
  unit?: string;
  onApply: (value: number) => void;
}) {
  const [value, setValue] = useState(String(initial));
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const n = Number(value);
        if (Number.isFinite(n)) onApply(n);
      }}
    >
      <input
        type="number"
        step="any"
        aria-label={label}
        className={`${inputClass} w-24`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {unit && <span className="text-xs text-slate-500">{unit}</span>}
      <Button type="submit" size="sm">
        Aplicar
      </Button>
    </form>
  );
}

export interface EntityControlsProps {
  entityId: string;
  definition: EntityDefinition;
  state: EntityState | undefined;
}

/** Botones para simular eventos sobre una entidad. */
export function EntityControls({ entityId, definition, state }: EntityControlsProps) {
  const setEntity = useSimulationStore((s) => s.setEntity);
  const apply = (next: EntityStateValue, attributes?: EntityState['attributes']) =>
    setEntity(entityId, { state: next, attributes: { ...state?.attributes, ...attributes } });

  const actions = quickActions(definition);
  const current = state?.state;

  if (definition.domain === 'button') {
    return (
      <Button size="sm" onClick={() => apply(new Date().toISOString())}>
        Pulsar
      </Button>
    );
  }

  if (definition.domain === 'sensor') {
    const numeric = typeof current === 'number' || (typeof current === 'string' && current !== '' && !Number.isNaN(Number(current)));
    if (numeric || definition.unit) {
      return (
        <NumberSetter
          key={entityId}
          label={`Nuevo valor de ${definition.name}`}
          initial={Number(current ?? 0) || 0}
          unit={definition.unit}
          onApply={(n) => apply(n)}
        />
      );
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {actions.map((a) => (
          <Button
            key={a.label}
            size="sm"
            variant={current === a.state ? 'primary' : 'secondary'}
            aria-pressed={current === a.state}
            onClick={() => apply(a.state)}
          >
            {a.label}
          </Button>
        ))}
      </div>
      {definition.domain === 'climate' && (
        <NumberSetter
          key={`${entityId}-temp`}
          label="Temperatura objetivo"
          initial={Number(state?.attributes?.temperature ?? 21) || 21}
          unit="°C"
          onApply={(n) => apply(current ?? 'heat', { temperature: n })}
        />
      )}
      {definition.domain === 'light' && (
        <NumberSetter
          key={`${entityId}-bri`}
          label="Brillo (0-255)"
          initial={Number(state?.attributes?.brightness ?? 255) || 255}
          onApply={(n) => apply(n > 0 ? 'on' : 'off', { brightness: Math.max(0, Math.min(255, Math.round(n))) })}
        />
      )}
    </div>
  );
}
