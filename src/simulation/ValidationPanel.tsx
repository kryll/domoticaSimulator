import { useMemo } from 'react';
import type { IssueSeverity, ValidationIssue } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { analyzeProject } from '../canvas/analysis';
import { catalog } from '../devices/catalog';
import { issueTitle } from '../network/validator';
import { quickFixesFor } from '../network/quickFixes';
import { applyQuickFix } from '../ui/quickFixActions';
import { EmptyState } from '../ui/Panel';
import { countLabel } from '../ui/plural';
import { cx } from '../ui/cx';

const GROUPS: Array<{ severity: IssueSeverity; title: string; tone: string; icon: string }> = [
  { severity: 'error', title: 'Errores', tone: 'border-red-200 bg-red-50 text-red-900', icon: '⛔' },
  { severity: 'warning', title: 'Avisos', tone: 'border-amber-200 bg-amber-50 text-amber-950', icon: '⚠️' },
  { severity: 'info', title: 'Información', tone: 'border-sky-200 bg-sky-50 text-sky-950', icon: 'ℹ️' },
];

export interface ValidationPanelProps {
  /** Incidencias a mostrar; por defecto, las del proyecto actual. */
  issues?: ValidationIssue[];
}

/** Lista de incidencias del validador agrupadas por severidad, con sus arreglos rápidos. */
export function ValidationPanel({ issues: given }: ValidationPanelProps) {
  const project = useProjectStore((s) => s.project);
  const issues = given ?? analyzeProject(project).issues;
  const fixes = useMemo(() => new Map(issues.map((i) => [i.id, quickFixesFor(i, project, catalog)])), [issues, project]);

  const focus = (issue: ValidationIssue) => {
    const ui = useUiStore.getState();
    const first = project.devices.find((d) => issue.deviceIds.includes(d.id));
    if (first) {
      if (ui.activeFloorId !== first.floorId) ui.setActiveFloor(first.floorId);
      ui.select({ kind: 'device', id: first.id });
    }
    ui.focusDevices(issue.deviceIds);
  };

  if (issues.length === 0) {
    return <EmptyState>✅ Sin incidencias: la instalación es coherente.</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {GROUPS.map((group) => {
        const list = issues.filter((i) => i.severity === group.severity);
        if (list.length === 0) return null;
        return (
          <section key={group.severity} aria-label={group.title}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {group.title} ({list.length})
            </h3>
            <ul className="flex flex-col gap-1">
              {list.map((issue) => {
                const names = issue.deviceIds
                  .map((id) => project.devices.find((d) => d.id === id)?.name)
                  .filter((n): n is string => Boolean(n));
                const issueFixes = fixes.get(issue.id) ?? [];
                const title = issueTitle(issue);
                return (
                  <li key={issue.id} className={cx('rounded-md border', group.tone)} data-code={issue.code}>
                    <button
                      type="button"
                      onClick={() => focus(issue)}
                      disabled={issue.deviceIds.length === 0}
                      title={`Código: ${issue.code}`}
                      className={cx(
                        'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 enabled:hover:brightness-95 disabled:cursor-default',
                      )}
                    >
                      <span aria-hidden="true">{group.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">{title}</span>
                        {issue.message !== title && <span className="block">{issue.message}</span>}
                        {names.length > 0 && (
                          <span className="block text-xs">
                            {countLabel(names.length, 'dispositivo', 'dispositivos')}: {names.join(', ')}
                          </span>
                        )}
                      </span>
                    </button>
                    {issueFixes.length > 0 && (
                      <div className="flex flex-wrap gap-1 px-2 pb-1.5 pl-8" role="group" aria-label={`Arreglos rápidos: ${title}`}>
                        {issueFixes.map((fix) => (
                          <button
                            key={fix.id}
                            type="button"
                            onClick={() => applyQuickFix(fix)}
                            className="rounded-md border border-current bg-white px-2 py-0.5 text-xs font-semibold hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600"
                          >
                            <span aria-hidden="true">🔧 </span>
                            {fix.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
