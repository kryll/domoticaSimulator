import type { EntityDefinition, EntityState, ServiceData } from '../../types';

/** Llamada a servicio con el nombre corto del servicio ("turn_on", "set_cover_position"...). */
export type ServiceCaller = (service: string, data?: ServiceData) => void;

export interface ControlProps {
  entityId: string;
  definition: EntityDefinition;
  state: EntityState | undefined;
  onService: ServiceCaller;
  /** Para el destino de una escena: oculta acciones momentáneas (parar, siguiente...). */
  target?: boolean;
}

/** Eventos físicos simulados (no son servicios de HA). */
export interface SensorEvents {
  motionPulse?: (entityId: string) => void;
  setBinary?: (entityId: string, on: boolean) => void;
  setValue?: (entityId: string, value: number) => void;
  press?: (entityId: string, action: string) => void;
  jam?: (entityId: string) => void;
}
