import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { shareUrl } from './share';

type CopyState = 'idle' | 'copied' | 'manual';

/** «Compartir»: enlace con el proyecto en el hash (#p=...) listo para copiar (B20). */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const project = useProjectStore((s) => s.project);
  const [withImages, setWithImages] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copy, setCopy] = useState<CopyState>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError(null);
    setCopy('idle');
    shareUrl(window.location.href, project, { omitImages: !withImages })
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [project, withImages]);

  const selectText = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const doCopy = async () => {
    if (!url) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('sin portapapeles');
      await navigator.clipboard.writeText(url);
      setCopy('copied');
    } catch {
      // Sin permiso o sin API: se selecciona el texto para copiarlo a mano.
      selectText();
      setCopy('manual');
    }
  };

  const kb = url ? (url.length / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1 }) : '';

  return (
    <Modal
      open
      size="lg"
      title="Compartir el proyecto"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button variant="primary" onClick={() => void doCopy()} disabled={!url}>
            Copiar enlace
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-slate-600">
          El enlace lleva el proyecto completo dentro (no se sube a ningún servidor). Quien lo abra lo verá como un proyecto nuevo, sin tocar los suyos.
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Enlace</span>
          <input
            ref={inputRef}
            readOnly
            value={url ?? (error ? '' : 'Generando…')}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded-md border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
          />
        </label>
        {error && (
          <p role="alert" className="rounded bg-red-50 px-2 py-1 text-sm text-red-800">
            No se pudo generar el enlace: {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} />
            Incluir las imágenes de fondo de las plantas
          </label>
          {url && <span>{kb} kB{url.length > 32_000 ? ' · enlace muy largo: algunos programas pueden cortarlo' : ''}</span>}
        </div>
        <p role="status" aria-live="polite" className="text-sm">
          {copy === 'copied' && <span className="text-emerald-700">✓ Enlace copiado al portapapeles</span>}
          {copy === 'manual' && <span className="text-amber-800">No se pudo copiar automáticamente: el enlace está seleccionado, pulsa Ctrl+C.</span>}
        </p>
      </div>
    </Modal>
  );
}
