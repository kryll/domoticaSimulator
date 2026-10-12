// Textos de la interfaz del laboratorio.
import type { NodeState, ServiceStatus } from './protocol';
import type { Connection } from './bridgeStore';

export const NODE_STATE_LABELS: Record<NodeState, string> = {
  stopped: 'Parado',
  starting: 'Arrancando',
  running: 'En marcha',
  error: 'Error',
};

export const CONNECTION_LABELS: Record<Connection, string> = {
  off: 'Desactivado',
  connecting: 'Conectando…',
  connected: 'Conectado',
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
