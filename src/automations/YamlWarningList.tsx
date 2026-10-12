import type { YamlWarning } from './yaml-parse';

/** Avisos del YAML antes de aplicar: «Se ignorarán: …». */
export function YamlWarningList({ warnings, max = 12 }: { warnings: readonly YamlWarning[]; max?: number }) {
  if (warnings.length === 0) return null;
  const shown = warnings.slice(0, max);
  return (
    <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
      <p className="font-medium">
        <span aria-hidden="true">⚠ </span>Se ignorarán {warnings.length === 1 ? '1 parte' : `${warnings.length} partes`} del YAML (puedes aplicarlo igualmente):
      </p>
      <ul className="mt-1 list-disc pl-4">
        {shown.map((w, i) => (
          <li key={`${w.path}-${i}`}>
            {w.path && <code className="mr-1 rounded bg-amber-100 px-1">{w.path}</code>}
            {w.message}
          </li>
        ))}
        {warnings.length > shown.length && <li>… y {warnings.length - shown.length} más</li>}
      </ul>
    </div>
  );
}
