import { useEffect, useState } from 'react';
import { useSimulationStore } from '../../store/simulationStore';
import { cx } from '../../ui/cx';

/** Tiempo real que se ve la burbuja (ms). */
export const BUBBLE_MS = 9000;

/**
 * Burbuja de voz del nodo (lo que oye, responde o anuncia un altavoz o satélite). Selector propio
 * por dispositivo: no reconstruye los datos del lienzo ni repinta otros nodos.
 */
export function SpeechBubble({ deviceId }: { deviceId: string }) {
  const bubble = useSimulationStore((s) => s.sim.speech?.[deviceId]);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!bubble) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), BUBBLE_MS);
    return () => clearTimeout(t);
  }, [bubble]);
  if (!bubble || !visible) return null;
  return (
    <span
      className={cx(
        'pointer-events-none absolute -top-2 left-1/2 z-10 w-max max-w-[240px] -translate-x-1/2 -translate-y-full rounded-xl border px-2 py-1 text-[11px] font-medium shadow-md',
        bubble.kind === 'heard' ? 'border-slate-300 bg-white text-slate-700' : bubble.kind === 'announce' ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-violet-300 bg-violet-50 text-violet-900',
      )}
      role="status"
      data-testid="speech-bubble"
    >
      {bubble.kind === 'heard' ? '🗣 ' : bubble.kind === 'announce' ? '🔊 ' : '💬 '}
      {bubble.text}
    </span>
  );
}
