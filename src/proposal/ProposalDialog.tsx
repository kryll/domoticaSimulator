import { useMemo, useRef, useState } from 'react';
import { knownDefinitions } from '../canvas/analysis';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useViewStore } from '../store/viewStore';
import { buildProposalHtml } from '../report/proposal';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { downloadText, safeFilename } from '../ui/download';
import { buildPlanSvg } from './planSvg';

/**
 * Propuesta para el cliente: genera el HTML con el plano (SVG), el presupuesto por partidas y
 * los datos de la propuesta, lo muestra en un iframe aislado y permite imprimirlo (Guardar como
 * PDF) o descargar el .html.
 */
export function ProposalDialog() {
  const project = useProjectStore((s) => s.project);
  const [generatedAt] = useState(() => new Date());
  const frameRef = useRef<HTMLIFrameElement>(null);
  const close = () => useViewStore.getState().setProposalOpen(false);

  const result = useMemo((): { html: string } | { error: string } => {
    try {
      const planSvg = buildPlanSvg(project, knownDefinitions());
      return { html: buildProposalHtml(project, knownDefinitions(), { ...(planSvg ? { planSvg } : {}), generatedAt }) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [project, generatedAt]);

  const print = () => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    try {
      win.focus();
      win.print();
    } catch {
      useUiStore.getState().notify('El navegador no deja imprimir desde la vista previa: descarga el .html y ábrelo para imprimirlo.', 'error');
    }
  };

  const download = () => {
    if (!('html' in result)) return;
    downloadText(result.html, `${safeFilename(project.name)}-propuesta.html`, 'text/html');
    useUiStore.getState().notify('Propuesta descargada', 'success');
  };

  return (
    <Modal
      open
      size="xl"
      title="Propuesta para el cliente"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cerrar
          </Button>
          <Button onClick={download} disabled={!('html' in result)}>
            Descargar .html
          </Button>
          <Button variant="primary" onClick={print} disabled={!('html' in result)}>
            Imprimir / Guardar como PDF
          </Button>
        </>
      }
    >
      {'error' in result ? (
        <p role="alert" className="rounded bg-red-50 px-2 py-1 text-sm text-red-800">
          No se pudo generar la propuesta: {result.error}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-slate-600">
            Vista previa. En el diálogo de impresión elige «Guardar como PDF». Los datos del cliente, la mano de obra y el IVA se editan en
            la pestaña «Presupuesto».
          </p>
          <iframe
            ref={frameRef}
            title="Vista previa de la propuesta"
            sandbox="allow-same-origin allow-modals"
            srcDoc={result.html}
            className="h-[60vh] w-full rounded border border-slate-300 bg-white"
          />
        </div>
      )}
    </Modal>
  );
}
