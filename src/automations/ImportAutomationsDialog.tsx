import { useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { Button } from '../ui/Button';
import { TextAreaField } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { readFileAsText } from '../ui/download';
import { parseAutomationsYamlDetailed } from './yaml-parse';
import { YamlWarningList } from './YamlWarningList';

type Preview =
  | { ok: true; count: number; names: string[]; warnings: ReturnType<typeof parseAutomationsYamlDetailed>['warnings'] }
  | { ok: false; error: string }
  | null;

/** Importa automatizaciones desde YAML de Home Assistant (pegado o desde un archivo). */
export function ImportAutomationsDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = useMemo<Preview>(() => {
    if (text.trim() === '') return null;
    try {
      const { automations, warnings } = parseAutomationsYamlDetailed(text, project);
      return { ok: true, count: automations.length, names: automations.map((a) => a.name), warnings };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [text, project]);

  const doImport = () => {
    const current = useProjectStore.getState().project;
    const { automations } = parseAutomationsYamlDetailed(text, current);
    if (automations.length === 0) return;
    // Un único paso de deshacer para todas.
    useProjectStore.getState().update((p) => ({ ...p, automations: [...p.automations, ...automations] }));
    const ui = useUiStore.getState();
    ui.selectAutomation(automations[0]?.id ?? null);
    ui.notify(automations.length === 1 ? 'Automatización importada' : `${automations.length} automatizaciones importadas`, 'success', {
      action: { label: 'Deshacer', run: () => useProjectStore.getState().undo() },
    });
    onClose();
  };

  const hasWarnings = preview?.ok === true && preview.warnings.length > 0;

  return (
    <Modal
      open
      size="lg"
      title="Importar automatizaciones (YAML)"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={preview?.ok !== true || preview.count === 0} onClick={doImport}>
            {hasWarnings ? 'Importar igualmente' : 'Importar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-xs text-slate-600">Pega el contenido de automations.yaml (una o varias automatizaciones) o elige un archivo.</p>
        <div>
          <Button size="sm" onClick={() => fileRef.current?.click()}>
            Elegir archivo…
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".yaml,.yml,text/yaml,text/plain"
            className="sr-only"
            tabIndex={-1}
            aria-label="Archivo YAML de automatizaciones"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) setText(await readFileAsText(file));
            }}
          />
        </div>
        <TextAreaField label="YAML" rows={12} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        {preview?.ok === false && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
            Error en el YAML: {preview.error}
          </p>
        )}
        {preview?.ok === true && (
          <>
            <p className="text-xs text-slate-700" role="status">
              {preview.count === 1 ? 'Se importará 1 automatización' : `Se importarán ${preview.count} automatizaciones`}
              {preview.names.length > 0 && `: ${preview.names.slice(0, 5).join(', ')}${preview.names.length > 5 ? '…' : ''}`}
            </p>
            <YamlWarningList warnings={preview.warnings} />
          </>
        )}
      </div>
    </Modal>
  );
}
