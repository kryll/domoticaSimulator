import { useId, useState } from 'react';
import { inputClass } from '../../ui/Field';
import { ASSIST_SATELLITE_LABELS, labelOf } from '../../devices/labels';
import { CtlButton } from './primitives';
import type { ControlProps } from './types';

/** Satélite de Assist: estado y anuncio (assist_satellite.announce) o pregunta (start_conversation). */
export function AssistSatelliteControl({ state, onService }: ControlProps) {
  const [text, setText] = useState('');
  const id = useId();
  const st = String(state?.state ?? 'idle');
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-slate-600">
        Estado: <strong>{labelOf(ASSIST_SATELLITE_LABELS, st)}</strong>
      </p>
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        Anuncio
      </label>
      <div className="flex gap-1">
        <input id={id} className={inputClass} value={text} placeholder="La lavadora ha terminado" onChange={(e) => setText(e.target.value)} />
        <CtlButton onClick={() => text.trim() && onService('announce', { message: text.trim() })} disabled={text.trim() === ''}>
          Anunciar
        </CtlButton>
        <CtlButton onClick={() => text.trim() && onService('start_conversation', { start_message: text.trim() })} disabled={text.trim() === ''} title="Pregunta y queda escuchando la respuesta">
          Preguntar
        </CtlButton>
      </div>
    </div>
  );
}
