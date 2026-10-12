import type { AssertOp, TimelineEventKind } from '../types';

export const EVENT_LABELS: Record<TimelineEventKind, string> = {
  state: 'Cambiar estado',
  service: 'Llamar a servicio',
  motion: 'Movimiento',
  button: 'Pulsar mando',
  door: 'Abrir/cerrar puerta',
  person: 'Mover persona',
  scene: 'Activar escena',
  script: 'Ejecutar script',
};

export const OP_LABELS: Record<AssertOp, string> = {
  eq: '=',
  ne: '≠',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
};

