import type { EntityDefinition, EntityState } from '../types';
import { useSimulationStore } from '../store/simulationStore';
import { ActuatorControl } from './controls/ActuatorControl';
import { BinarySensorControl, NumericSensorControl, RemoteControl } from './controls/SensorControl';
import { isRemoteEntity } from './controls/labels';
import { useSensorEvents } from './controls/useSensorEvents';

export interface EntityControlsProps {
  entityId: string;
  definition: EntityDefinition;
  state: EntityState | undefined;
}

function isNumeric(v: unknown): boolean {
  return typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)));
}

/**
 * Controles de simulación de una entidad. Los actuadores pasan siempre por callService (la misma
 * vía que las automatizaciones) y los sensores por los eventos simulados; nunca se escribe el
 * estado en crudo.
 */
export function EntityControls({ entityId, definition, state }: EntityControlsProps) {
  const callService = useSimulationStore((s) => s.callService);
  const events = useSensorEvents();
  const onService = (service: string, data?: Parameters<typeof callService>[2]) => callService(entityId, service, data);

  if (isRemoteEntity(definition)) {
    return <RemoteControl entityId={entityId} definition={definition} state={state} onService={onService} events={events} />;
  }
  if (definition.domain === 'binary_sensor') {
    return <BinarySensorControl entityId={entityId} definition={definition} state={state} onService={onService} events={events} />;
  }
  if (definition.domain === 'sensor') {
    if (isNumeric(state?.state) || isNumeric(definition.initialState) || definition.unit) {
      return <NumericSensorControl entityId={entityId} definition={definition} state={state} onService={onService} events={events} />;
    }
    return null;
  }
  return <ActuatorControl entityId={entityId} definition={definition} state={state} onService={onService} events={events} />;
}
