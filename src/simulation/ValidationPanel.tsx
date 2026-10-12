import type { IssueSeverity, ValidationIssue } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { analyzeProject } from '../canvas/analysis';
import { EmptyState } from '../ui/Panel';
import { cx } from '../ui/cx';

const GROUPS: Array<{ severity: IssueSeverity; title: string; tone: string; icon: string }> = [
  { severity: 'error', title: 'Errores', tone: 'border-red-200 bg-red-50 text-red-800', icon: '⛔' },
  { severity: 'warning', title: 'Avisos', tone: 'border-amber-200 bg-amber-50 text-amber-900', icon: '⚠️' },
  { severity: 'info', title: 'Información', tone: 'border-sky-200 bg-sky-50 text-sky-900', icon: 'ℹ️' },
];

export interface ValidationPanelProps {
  /** Incidencias a mostrar; por defecto, las del proyecto actual. */
  issues?: ValidationIssue[];
}

/** Lista de incidencias del validador agrupadas por severidad. */
export function ValidationPanel({ issues: given }: ValidationPanelProps) {
  const project = useProjectStore((s) => s.project);
  const issues = given ?? analyzeProject(project).issues;

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
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {group.title} ({list.length})
            </h3>
            <ul className="flex flex-col gap-1">
              {list.map((issue) => {
                const names = issue.deviceIds
                  .map((id) => project.devices.find((d) => d.id === id)?.name)
                  .filter((n): n is string => Boolean(n));
                return (
                  <li key={issue.id}>
                    <button
                      type="button"
                      onClick={() => focus(issue)}
                      disabled={issue.deviceIds.length === 0}
                      className={cx(
                        'flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-sm',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 enabled:hover:brightness-95',
                        group.tone,
                      )}
                    >
                      <span aria-hidden="true">{group.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block">{issue.message}</span>
                        {names.length > 0 && <span className="block text-xs opacity-75">{names.join(', ')}</span>}
                      </span>
                      <code className="hidden shrink-0 text-[10px] opacity-60 sm:block">{issue.code}</code>
                    </button>
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
