// Etiquetas y plantillas de triggers, condiciones y acciones para los editores.
import type { Action, Condition, Trigger } from '../types';
import {
  advancedActionFactories,
  advancedConditionFactories,
  advancedTriggerFactories,
} from './advancedAutomationOptions';
import { notifyAction } from '../simulation/notify';

export const TRIGGER_LABELS: Record<Trigger['type'], string> = {
  state: 'Cambio de estado',
  numeric_state: 'Valor numérico',
  time: 'Hora',
  sun: 'Sol',
  zone: 'Zona (persona)',
  device_action: 'Acción de mando',
};

export const triggerFactories: Array<{ label: string; create: () => Trigger }> = [
  { label: TRIGGER_LABELS.state, create: () => ({ type: 'state', entityId: '', to: 'on' }) },
  { label: TRIGGER_LABELS.numeric_state, create: () => ({ type: 'numeric_state', entityId: '', above: 25 }) },
  { label: TRIGGER_LABELS.time, create: () => ({ type: 'time', at: '07:00' }) },
  { label: TRIGGER_LABELS.sun, create: () => ({ type: 'sun', event: 'sunset' }) },
  ...advancedTriggerFactories,
];

export const CONDITION_LABELS: Record<Condition['type'], string> = {
  state: 'Estado',
  numeric_state: 'Valor numérico',
  time: 'Franja horaria',
  sun: 'Sol (día/noche)',
  and: 'Todas (Y)',
  or: 'Alguna (O)',
  not: 'Ninguna (NO)',
  zone: 'Persona en zona',
};

export const conditionFactories: Array<{ label: string; create: () => Condition }> = [
  { label: CONDITION_LABELS.state, create: () => ({ type: 'state', entityId: '', state: 'on' }) },
  { label: CONDITION_LABELS.numeric_state, create: () => ({ type: 'numeric_state', entityId: '' }) },
  { label: CONDITION_LABELS.time, create: () => ({ type: 'time', after: '08:00', before: '22:00' }) },
  { label: CONDITION_LABELS.sun, create: () => ({ type: 'sun', after: 'sunset', before: 'sunrise' }) },
  { label: CONDITION_LABELS.and, create: () => ({ type: 'and', conditions: [] }) },
  { label: CONDITION_LABELS.or, create: () => ({ type: 'or', conditions: [] }) },
  ...advancedConditionFactories,
];

export const ACTION_LABELS: Record<Action['type'], string> = {
  service: 'Llamar a servicio',
  scene: 'Activar escena',
  script: 'Ejecutar script',
  delay: 'Esperar',
  choose: 'Elegir (choose)',
  if: 'Si / entonces / si no',
  wait_for_trigger: 'Esperar a un disparador',
  repeat: 'Repetir',
  notify: 'Notificación',
  variables: 'Variables',
};

export const actionFactories: Array<{ label: string; create: () => Action }> = [
  { label: ACTION_LABELS.service, create: () => ({ type: 'service', service: '', entityId: '' }) },
  // Servicio notify.persistent_notification de HA (Fase 2). La acción «Notificación» de la Fase 3
  // (notify.notify, con plantillas) está en advancedActionFactories; las dos llegan a la bandeja.
  { label: 'Notificación persistente', create: () => notifyAction('') },
  { label: ACTION_LABELS.scene, create: () => ({ type: 'scene', sceneId: '' }) },
  { label: ACTION_LABELS.script, create: () => ({ type: 'script', scriptId: '' }) },
  { label: ACTION_LABELS.delay, create: () => ({ type: 'delay', seconds: 5 }) },
  ...advancedActionFactories,
];
