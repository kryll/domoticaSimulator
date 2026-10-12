import { useEffect, useMemo, useState } from 'react';
import type { Automation } from '../types';
import { automationToYaml, type YamlContext } from '../export/yaml';
import { useProjectStore } from '../store/projectStore';
import { parseAutomationYamlDetailed } from './yaml-parse';
import { YamlWarningList } from './YamlWarningList';
import { Button } from '../ui/Button';
import { TextAreaField } from '../ui/Field';

function safeYaml(a: Automation, ctx: YamlContext): string {
  try {
    return automationToYaml(a, ctx);
  } catch (err) {
    return `# No se pudo generar el YAML: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Edición en YAML sincronizada con el editor visual. */
export function AutomationYamlEditor({ automation, onChange }: { automation: Automation; onChange: (a: Automation) => void }) {
  // El proyecto hace de contexto: escenas, scripts, salas (area_id), personas y zonas.
  const project = useProjectStore((s) => s.project);
  const generated = safeYaml(automation, project);
  const [text, setText] = useState(generated);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setText(generated);
  }, [generated, dirty]);

  // Avisos en vivo: lo que el simulador ignorará al aplicar (se puede aplicar igualmente).
  const warnings = useMemo(() => {
    if (!dirty) return [];
    try {
      return parseAutomationYamlDetailed(text, project).warnings;
    } catch {
      return [];
    }
  }, [dirty, text, project]);

  const apply = () => {
    try {
      const parsed = parseAutomationYamlDetailed(text, project).automation;
      onChange({ ...parsed, id: automation.id });
      setDirty(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <TextAreaField
        label="YAML de la automatización"
        rows={16}
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        aria-invalid={error ? true : undefined}
      />
      {error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
          Error en el YAML: {error}
        </p>
      )}
      <YamlWarningList warnings={warnings} />
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={apply} disabled={!dirty}>
          {warnings.length > 0 ? 'Aplicar igualmente' : 'Aplicar YAML'}
        </Button>
        <Button
          size="sm"
          disabled={!dirty}
          onClick={() => {
            setText(generated);
            setDirty(false);
            setError(null);
          }}
        >
          Descartar cambios
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(text)}>
          Copiar
        </Button>
      </div>
    </div>
  );
}
