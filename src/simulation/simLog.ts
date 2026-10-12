// Registro (logbook) de la simulación: entradas con id secuencial y tamaño acotado. Puro.
import type { Id, LogEntry, LogLevel, SimulationState } from '../types';

/** Entradas máximas del registro (se conservan las más recientes, al final). */
export const MAX_LOG_ENTRIES = 500;

export function nextSeq(log: LogEntry[]): number {
  const last = log[log.length - 1];
  const n = last ? Number(last.id.replace(/^log-/, '')) : 0;
  return Number.isFinite(n) ? n + 1 : log.length + 1;
}

/** Añade una entrada al registro (id secuencial, registro acotado). */
export function appendLog(
  sim: SimulationState,
  level: LogLevel,
  message: string,
  extra: { entityId?: string; automationId?: Id } = {},
): SimulationState {
  return addLog(sim, level, message, extra);
}

export interface LogExtra {
  entityId?: string;
  automationId?: Id;
  /** Fase 3 (B14): cambio de estado registrado. */
  change?: LogEntry['change'];
  /** Notificación enviada (acción notify o servicio notify.*). */
  notification?: LogEntry['notification'];
}

export function addLog(sim: SimulationState, level: LogLevel, message: string, extra: LogExtra = {}): SimulationState {
  const entry: LogEntry = { id: `log-${nextSeq(sim.log)}`, timestamp: sim.now, level, message };
  if (extra.entityId !== undefined) entry.entityId = extra.entityId;
  if (extra.automationId !== undefined) entry.automationId = extra.automationId;
  if (extra.change !== undefined) entry.change = extra.change;
  if (extra.notification !== undefined) entry.notification = extra.notification;
  const log = [...sim.log, entry];
  return { ...sim, log: log.length > MAX_LOG_ENTRIES ? log.slice(log.length - MAX_LOG_ENTRIES) : log };
}
