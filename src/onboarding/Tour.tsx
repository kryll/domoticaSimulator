import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { TOUR_STEPS, useViewStore } from '../store/viewStore';
import { Button } from '../ui/Button';
import { trapTab } from '../ui/focusTrap';
import { TOUR } from './tourSteps';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function targetRect(selector: string): Rect | null {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { top: r.top - 4, left: r.left - 4, width: r.width + 8, height: r.height + 8 };
}

/** Posición del cuadro del tour: junto a la zona resaltada sin salirse de la ventana. */
function boxStyle(rect: Rect | null): CSSProperties {
  const w = Math.min(340, window.innerWidth - 32);
  if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: w };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceRight = vw - (rect.left + rect.width);
  let left: number;
  let top: number;
  if (spaceRight > w + 24) left = rect.left + rect.width + 12;
  else if (rect.left > w + 24) left = rect.left - w - 12;
  else left = Math.max(16, Math.min(vw - w - 16, rect.left + rect.width / 2 - w / 2));
  if (left === rect.left + rect.width + 12 || left === rect.left - w - 12) top = Math.max(16, Math.min(vh - 260, rect.top + 16));
  else top = rect.top > vh / 2 ? Math.max(16, rect.top - 230) : Math.min(vh - 260, rect.top + rect.height + 12);
  return { top, left, width: w };
}

/** Mini tour de 5 pasos con la zona resaltada. Esc o «Saltar» lo cierran y se recuerda. */
export function Tour() {
  const step = useViewStore((s) => s.tourStep);
  const setStep = useViewStore((s) => s.setTourStep);
  const endTour = useViewStore((s) => s.endTour);
  const [rect, setRect] = useState<Rect | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const info = step === null ? undefined : TOUR[step];

  useLayoutEffect(() => {
    if (!info) return;
    const update = () => setRect(targetRect(info.target));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [info]);

  const open = step !== null;
  useEffect(() => {
    if (!open) return;
    // Al cerrar el tour el foco vuelve a donde estaba.
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, [open]);

  useEffect(() => {
    if (step === null) return;
    titleRef.current?.focus();
  }, [step]);

  if (step === null || !info) return null;
  const last = step === TOUR_STEPS - 1;

  return (
    <div className="fixed inset-0 z-[60]" data-export-ignore="">
      {rect ? (
        <div className="ha-tour-spot" style={rect} aria-hidden="true" data-testid="tour-spot" />
      ) : (
        <div className="fixed inset-0 bg-slate-900/55" aria-hidden="true" />
      )}
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        className="fixed z-[61] rounded-lg border border-slate-200 bg-white p-4 shadow-2xl"
        style={boxStyle(rect)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            endTour();
          } else if (e.key === 'ArrowRight' && !last) setStep(step + 1);
          else if (e.key === 'ArrowLeft' && step > 0) setStep(step - 1);
          else trapTab(e, boxRef.current);
        }}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">
          Paso {step + 1} de {TOUR_STEPS}
        </p>
        <h2 id="tour-title" ref={titleRef} tabIndex={-1} className="mt-0.5 text-base font-semibold text-slate-900 focus:outline-none">
          {info.title}
        </h2>
        <p id="tour-text" className="mt-1 text-sm text-slate-700">
          {info.text}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={endTour}>
            Saltar tour
          </Button>
          <span className="ml-auto" />
          {step > 0 && (
            <Button size="sm" onClick={() => setStep(step - 1)}>
              Anterior
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => (last ? endTour() : setStep(step + 1))}>
            {last ? 'Terminar' : 'Siguiente'}
          </Button>
        </div>
      </div>
    </div>
  );
}
