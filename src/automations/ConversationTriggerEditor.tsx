import { useId, useState } from 'react';
import type { ConversationTrigger } from '../types';
import { inputClass } from '../ui/Field';

/** Disparador de frase de Assist: una frase por línea, con [opcional], (a|b) y {comodín}. */
export function ConversationTriggerEditor({ value, onChange }: { value: ConversationTrigger; onChange: (t: ConversationTrigger) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(value.command.join('\n'));
  const commit = (text: string) => {
    const command = text.split('\n').map((x) => x.trim()).filter((x) => x !== '');
    onChange({ ...value, command });
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="mb-1 text-xs font-semibold text-slate-700">Frase de Assist</div>
      <label htmlFor={id} className="text-xs font-medium text-slate-600">
        Frases (una por línea)
      </label>
      <textarea
        id={id}
        rows={3}
        className={inputClass}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value);
        }}
        placeholder={'[Oye] buenas noches\n(me voy|salgo) de casa'}
      />
      <p className="text-xs text-slate-500">
        Solo la entienden los asistentes de Assist (HA Voice, Wyoming, ESP32-S3-BOX); tiene prioridad sobre las intenciones. [x] es opcional, (a|b) es una alternativa y {'{nombre}'} un comodín.
      </p>
    </div>
  );
}
