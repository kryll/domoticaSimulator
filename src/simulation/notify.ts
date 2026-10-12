// Notificaciones. Hay dos formas de enviarlas y comparten una sola vía en el motor
// (sendNotification en engine.ts):
// - Fase 2: el servicio de HA `notify.persistent_notification` (o cualquier notify.*) con datos
//   message/title. Se exporta como `action: notify.persistent_notification`.
// - Fase 3: la acción `notify` del editor (NotifyAction), con plantillas {{ }} en título y mensaje.
//   Se exporta como `action: notify.notify` (o el servicio que indique).
// Las dos dejan la notificación en la bandeja (SimulationState.notifications, deliverNotification)
// y en el registro (LogEntry.notification).
import type { Action, EntityStateValue, ServiceData, SimulationState } from '../types';
import { addNotification } from './logic';

/** Título de la bandeja cuando la notificación no trae uno (como HA). */
export const DEFAULT_NOTIFICATION_TITLE = 'Home Assistant';

/** Servicio de notificación universal de HA (no necesita entidad ni Internet). */
export const NOTIFY_PERSISTENT = 'notify.persistent_notification';

/** ¿Es un servicio de notificación (dominio notify, sin entidad de destino)? */
export function isNotifyService(service: string): boolean {
  return service.startsWith('notify.');
}

/**
 * ¿La notificación sale por la nube? Todos los notify.* (app móvil, notify.notify...) salvo la
 * notificación persistente, que se queda en Home Assistant.
 */
export function isCloudNotifyService(service: string): boolean {
  return isNotifyService(service) && service !== NOTIFY_PERSISTENT;
}

export interface NotificationContent {
  title?: string;
  message: string;
}

/** Contenido de la notificación a partir de los datos de la llamada (undefined si falta el mensaje). */
export function notificationContent(data: ServiceData | Record<string, EntityStateValue> | undefined): NotificationContent | undefined {
  const message = data?.message;
  if (message === undefined || Array.isArray(message) || String(message).trim() === '') return undefined;
  const content: NotificationContent = { message: String(message) };
  const title = data?.title;
  if (title !== undefined && !Array.isArray(title) && String(title).trim() !== '') content.title = String(title);
  return content;
}

/** Texto de la notificación para el registro: «Notificación: Título — mensaje». */
export function formatNotification(n: NotificationContent): string {
  return `Notificación: ${n.title ? `${n.title} — ` : ''}${n.message}`;
}

/** Acción que envía una notificación persistente (entityId vacío: no tiene entidad de destino). */
export function notifyAction(message: string, title?: string): Action {
  const data: Record<string, EntityStateValue> = { message };
  if (title !== undefined) data.title = title;
  return { type: 'service', service: NOTIFY_PERSISTENT, entityId: '', data };
}

/** Deja la notificación en la bandeja de la simulación (sin título: «Home Assistant»). */
export function deliverNotification(sim: SimulationState, n: NotificationContent): SimulationState {
  return addNotification(sim, n.title ?? DEFAULT_NOTIFICATION_TITLE, n.message);
}
