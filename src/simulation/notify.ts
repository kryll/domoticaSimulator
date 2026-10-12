// Notificaciones (servicio notify.persistent_notification de HA). Aislado del motor para que la
// Fase 3 pueda añadir una acción `notify` propia sin choques: el motor solo llama a estas funciones.
import type { Action, EntityStateValue, ServiceData } from '../types';

/** Servicio de notificación universal de HA (no necesita entidad ni Internet). */
export const NOTIFY_PERSISTENT = 'notify.persistent_notification';

/** ¿Es un servicio de notificación (dominio notify, sin entidad de destino)? */
export function isNotifyService(service: string): boolean {
  return service.startsWith('notify.');
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
