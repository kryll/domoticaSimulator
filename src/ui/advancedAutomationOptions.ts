// Etiquetas y plantillas de los disparadores, condiciones y acciones de la Fase 3 (B9, B11).
// Se combinan con las básicas en automationOptions.ts.
import type {
  Action,
  ChooseAction,
  Condition,
  DeviceActionTrigger,
  IfAction,
  NotCondition,
  NotifyAction,
  RepeatAction,
  Trigger,
  VariablesAction,
  WaitForTriggerAction,
  ZoneCondition,
  ZoneTrigger,
} from '../types';

type AdvancedTrigger = ZoneTrigger | DeviceActionTrigger;
type AdvancedCondition = NotCondition | ZoneCondition;
type AdvancedAction = ChooseAction | IfAction | WaitForTriggerAction | RepeatAction | NotifyAction | VariablesAction;

export const ADVANCED_TRIGGER_LABELS: Record<AdvancedTrigger['type'], string> = {
  zone: 'Zona (persona)',
  device_action: 'Acción de mando',
};

export const advancedTriggerFactories: Array<{ label: string; create: () => Trigger }> = [
  { label: ADVANCED_TRIGGER_LABELS.zone, create: () => ({ type: 'zone', personId: '', zoneId: 'home', event: 'enter' }) },
  { label: ADVANCED_TRIGGER_LABELS.device_action, create: () => ({ type: 'device_action', entityId: '', action: 'single' }) },
];

export const ADVANCED_CONDITION_LABELS: Record<AdvancedCondition['type'], string> = {
  not: 'Ninguna (NO)',
  zone: 'Persona en zona',
};

export const advancedConditionFactories: Array<{ label: string; create: () => Condition }> = [
  { label: ADVANCED_CONDITION_LABELS.not, create: () => ({ type: 'not', conditions: [] }) },
  { label: ADVANCED_CONDITION_LABELS.zone, create: () => ({ type: 'zone', personId: '', zoneId: 'home' }) },
];

export const ADVANCED_ACTION_LABELS: Record<AdvancedAction['type'], string> = {
  choose: 'Elegir (choose)',
  if: 'Si / entonces / si no',
  wait_for_trigger: 'Esperar a un disparador',
  repeat: 'Repetir',
  notify: 'Notificación',
  variables: 'Variables',
};

export const advancedActionFactories: Array<{ label: string; create: () => Action }> = [
  { label: ADVANCED_ACTION_LABELS.choose, create: () => ({ type: 'choose', choices: [{ conditions: [], sequence: [] }] }) },
  { label: ADVANCED_ACTION_LABELS.if, create: () => ({ type: 'if', conditions: [], then: [] }) },
  {
    label: ADVANCED_ACTION_LABELS.wait_for_trigger,
    create: () => ({ type: 'wait_for_trigger', triggers: [], timeoutSeconds: 60, continueOnTimeout: true }),
  },
  { label: ADVANCED_ACTION_LABELS.repeat, create: () => ({ type: 'repeat', count: 2, sequence: [] }) },
  { label: ADVANCED_ACTION_LABELS.notify, create: () => ({ type: 'notify', title: 'Casa', message: '' }) },
  { label: ADVANCED_ACTION_LABELS.variables, create: () => ({ type: 'variables', variables: {} }) },
];
