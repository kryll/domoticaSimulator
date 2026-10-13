import { useId, useState } from 'react';
import type { Device, DeviceDefinition } from '../../types';
import { useSimulationStore } from '../../store/simulationStore';
import { inputClass } from '../../ui/Field';
import { EXAMPLE_PHRASES } from '../assist';
import { ASSISTANT_LABELS, alexaNotifyService, wakePrefix } from '../voice';
import { CtlButton } from './primitives';

/** Cómo llega cada asistente a HA (texto honesto de lo que HA expone de verdad). */
function assistantNote(def: DeviceDefinition): string {
  switch (def.assistant?.kind) {
    case 'assist':
      return 'Assist de Home Assistant: la canalización (reconocimiento y voz) es local o la que elijas. Entiende las entidades expuestas a Assist y las frases personalizadas.';
    case 'alexa':
      return 'Alexa vive en la nube de Amazon. Controla HA con la skill «Alexa Smart Home» (Home Assistant Cloud de pago o configuración manual con HTTPS público) y solo ve lo expuesto a Alexa. Las rutinas de Alexa no son de HA: no se modelan.';
    case 'google':
      return 'Google Assistant vive en la nube de Google. Controla HA con «Google Assistant» (Home Assistant Cloud de pago o configuración manual con HTTPS público) y solo ve lo expuesto a Google. Las rutinas de Google Home no son de HA: no se modelan.';
    case 'siri':
      return 'HA ve el HomePod solo como reproductor (integración Apple TV/AirPlay). Siri no se controla desde HA: para usar Siri, expón entidades a Apple Casa con el puente HomeKit.';
    default:
      return '';
  }
}

/** «Decir al asistente…» con frases de ejemplo y la última respuesta. */
export function AssistPanel({ device, def }: { device: Device; def: DeviceDefinition }) {
  const say = useSimulationStore((s) => s.say);
  const bubble = useSimulationStore((s) => s.sim.speech?.[device.id]);
  const [text, setText] = useState('');
  const inputId = useId();
  const listId = useId();
  const info = def.assistant;
  if (!info) return null;
  const prefix = wakePrefix(info);
  const name = ASSISTANT_LABELS[info.kind];
  const submit = (phrase: string) => {
    const t = phrase.trim();
    if (t === '') return;
    say(device.id, `${prefix}${t}`);
    setText('');
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-violet-200 bg-violet-50/60 p-2 text-xs" data-testid="assist-panel">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-violet-900">🗣 {name}</strong>
        <span className={`rounded px-1.5 font-semibold ${info.pipeline === 'local' ? 'bg-emerald-100 text-emerald-800' : 'bg-violet-100 text-violet-800'}`}>{info.pipeline === 'local' ? 'Local' : 'Nube'}</span>
      </div>
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <label htmlFor={inputId} className="sr-only">
          Decir a {name}
        </label>
        {prefix && <span className="self-center whitespace-nowrap font-semibold text-violet-800">{prefix.trim()}</span>}
        <input id={inputId} list={listId} className={inputClass} placeholder={`Decir a ${name}…`} value={text} onChange={(e) => setText(e.target.value)} data-testid="assist-input" />
        <datalist id={listId}>
          {EXAMPLE_PHRASES.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <CtlButton variant="primary" onClick={() => submit(text)} disabled={text.trim() === ''}>
          Decir
        </CtlButton>
      </form>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Frases de ejemplo">
        {EXAMPLE_PHRASES.slice(0, 4).map((p) => (
          <button key={p} type="button" className="rounded-full border border-violet-300 bg-white px-2 py-0.5 text-violet-800 hover:bg-violet-100" onClick={() => submit(p)}>
            {prefix}
            {p}
          </button>
        ))}
      </div>
      {bubble && (
        <p className="rounded bg-white px-2 py-1 text-slate-800" aria-live="polite" data-testid="assist-reply">
          {bubble.kind === 'heard' ? '🗣' : '💬'} {bubble.text}
        </p>
      )}
      <p className="text-slate-600">{assistantNote(def)}</p>
      {device.integration === 'alexa_media_player' && (
        <p className="text-slate-600">
          Desde HA: <code>{alexaNotifyService(device)}</code> para anuncios y TTS, y el reproductor <code>media_player</code>.
        </p>
      )}
      {device.integration === 'google_cast' && (
        <p className="text-slate-600">
          Desde HA: <code>tts.speak</code> sobre su <code>media_player</code> (Google Cast) para anuncios.
        </p>
      )}
    </div>
  );
}
