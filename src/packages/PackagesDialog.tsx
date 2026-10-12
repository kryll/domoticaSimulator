import { useMemo, useState } from 'react';
import { countLabel } from '../ui/plural';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { catalog } from '../devices/catalog';
import { projectToPackages } from '../export/packages';
import { zipFiles } from '../export/zip';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { downloadBlob, safeFilename } from '../ui/download';
import { cx } from '../ui/cx';
import { MarkdownView } from './MarkdownView';

const GUIDE = 'GUIA_EMPAREJAMIENTO.md';

function sizeLabel(text: string): string {
  const bytes = new TextEncoder().encode(text).length;
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1 })} kB`;
}

/** Exportación a Home Assistant real: packages/ por área, areas.yaml y la guía de emparejamiento (B16). */
export function PackagesDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const files = useMemo(() => projectToPackages(project, catalog), [project]);
  const [selected, setSelected] = useState(GUIDE);
  const current = files.find((f) => f.path === selected) ?? files[0];

  const download = () => {
    try {
      const zip = zipFiles(files.map((f) => ({ path: f.path, content: f.content })));
      // Copia en un ArrayBuffer propio (Blob no acepta vistas sobre SharedArrayBuffer).
      const bytes = new Uint8Array(zip.byteLength);
      bytes.set(zip);
      downloadBlob(new Blob([bytes.buffer], { type: 'application/zip' }), `${safeFilename(project.name)}-home-assistant.zip`);
      useUiStore.getState().notify(`Descargado el .zip con ${countLabel(files.length, 'archivo', 'archivos')}`, 'success');
    } catch (err) {
      useUiStore.getState().notify(`No se pudo generar el .zip: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  return (
    <Modal
      open
      size="xl"
      title="Configuración para Home Assistant (packages)"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button variant="primary" onClick={download}>
            ⬇ Descargar .zip
          </Button>
        </>
      }
    >
      <div className="flex min-h-0 flex-col gap-3 md:flex-row">
        <nav aria-label="Archivos del paquete" className="shrink-0 md:w-60">
          <p className="mb-1 text-xs text-slate-500">
            Copia <code>packages/</code> junto a <code>configuration.yaml</code> y sigue la guía.
          </p>
          <ul className="flex flex-col gap-0.5">
            {files.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  aria-current={current?.path === f.path ? 'true' : undefined}
                  onClick={() => setSelected(f.path)}
                  className={cx(
                    'flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
                    current?.path === f.path ? 'bg-sky-50 font-semibold text-sky-800' : 'text-slate-700 hover:bg-slate-50',
                  )}
                >
                  <span className="truncate font-mono">
                    <span aria-hidden="true">{f.path === GUIDE ? '📘 ' : '📄 '}</span>
                    {f.path}
                  </span>
                  <span className="shrink-0 text-slate-400">{sizeLabel(f.content)}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <section
          aria-label={current ? `Vista previa de ${current.path}` : 'Vista previa'}
          className="min-w-0 flex-1 overflow-auto rounded border border-slate-200 p-3"
        >
          {current?.path.endsWith('.md') ? (
            <MarkdownView source={current.content} />
          ) : (
            <pre className="whitespace-pre font-mono text-xs text-slate-800">{current?.content}</pre>
          )}
        </section>
      </div>
    </Modal>
  );
}
