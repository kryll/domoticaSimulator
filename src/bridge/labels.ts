// Textos de la interfaz del laboratorio.
import type { NativeServiceState, NodeState, ServiceStatus } from './protocol';
import type { Connection } from './bridgeStore';

export const NODE_STATE_LABELS: Record<NodeState, string> = {
  stopped: 'Parado',
  starting: 'Arrancando',
  running: 'En marcha',
  error: 'Error',
};

export const CONNECTION_LABELS: Record<Connection, string> = {
  off: 'Desactivado',
  other_tab: 'Controlado desde otra pestaña',
  connecting: 'Conectando…',
  connected: 'Conectado',
  readonly: 'Solo lectura (otra app lo controla)',
  unauthorized: 'Token no válido o ausente',
  disconnected: 'Sin conexión',
};

export const SERVICE_LABELS: Record<ServiceStatus, string> = {
  connected: 'Conectado',
  connecting: 'Conectando…',
  disconnected: 'Sin conexión',
};

export const HA_LABELS: Record<'online' | 'offline' | 'unknown', string> = {
  online: 'En marcha',
  offline: 'Parado o reiniciando',
  unknown: 'Sin noticias todavía',
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Aviso de la segunda pestaña (candado entre pestañas). */
export const OTHER_TAB_MESSAGE = 'El laboratorio está controlado desde otra pestaña';

/** Estado de una vía real (Z-Wave JS, ESPHome). */
export const NATIVE_STATE_LABELS: Record<NativeServiceState, string> = {
  disabled: 'Desactivada',
  connecting: 'Conectando…',
  connected: 'Conectada',
  error: 'Error',
};
