// Textos e iconos de las trazas de automatizaciones.
import type { AutomationTrace, TraceActionStatus, TraceResult } from '../types';

export const TRACE_RESULT: Record<TraceResult, { label: string; icon: string; tone: 'green' | 'amber' | 'red' | 'slate' | 'sky' }> = {
  ran: { label: 'Ejecutada', icon: '✓', tone: 'green' },
  conditions_failed: { label: 'Condiciones no cumplidas', icon: '✗', tone: 'amber' },
  skipped_single: { label: 'Omitida (ya estaba en marcha)', icon: '⏭', tone: 'slate' },
  queued: { label: 'En cola', icon: '⏳', tone: 'sky' },
  error: { label: 'Error', icon: '⚠', tone: 'red' },
  ha_unavailable: { label: 'Home Assistant no disponible', icon: '⛔', tone: 'red' },
};

export const ACTION_STATUS: Record<TraceActionStatus, { label: string; icon: string; className: string }> = {
  done: { label: 'Hecha', icon: '✓', className: 'text-emerald-700' },
  waiting: { label: 'Esperando', icon: '⏳', className: 'text-sky-700' },
  skipped: { label: 'No ejecutada', icon: '–', className: 'text-slate-500' },
  error: { label: 'Error', icon: '✗', className: 'text-red-700' },
};

export function traceTriggerText(trace: AutomationTrace): string {
  return 'manual' in trace.trigger ? 'Ejecución manual' : trace.trigger.description;
}

/** Última traza de cada automatización. */
export function lastTraceByAutomation(traces: readonly AutomationTrace[] | undefined): Map<string, AutomationTrace> {
  const map = new Map<string, AutomationTrace>();
  for (const t of traces ?? []) {
    const prev = map.get(t.automationId);
    if (!prev || t.startedAt >= prev.startedAt) map.set(t.automationId, t);
  }
  return map;
}
