import { useEffect, useState } from 'react';
import type { Automation } from '../types';
import { automationToYaml, type YamlContext } from '../export/yaml';
import { useProjectStore } from '../store/projectStore';
import { parseAutomationYaml } from './yaml-parse';
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
  const scenes = useProjectStore((s) => s.project.scenes);
  const scripts = useProjectStore((s) => s.project.scripts);
  const generated = safeYaml(automation, { scenes, scripts });
  const [text, setText] = useState(generated);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) setText(generated);
  }, [generated, dirty]);

  const apply = () => {
    try {
      const parsed = parseAutomationYaml(text, { scenes, scripts });
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
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={apply} disabled={!dirty}>
          Aplicar YAML
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
