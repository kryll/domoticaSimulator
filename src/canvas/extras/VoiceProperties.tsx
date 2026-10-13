import { useId } from 'react';
import type { Device, VoiceTarget } from '../../types';
import { useProjectStore } from '../../store/projectStore';
import { definitionOf, knownDefinitions } from '../analysis';
import { ASSISTANT_LABELS, exposeRoom, isExposed, toggleExposure } from '../../simulation/voice';
import { vacuumRooms } from '../../simulation/vacuum';
import { inputClass } from '../../ui/Field';

const TARGETS: VoiceTarget[] = ['assist', 'alexa', 'google'];

/**
 * Sección «Asistentes» de Propiedades: a qué asistentes se exponen las entidades del dispositivo
 * (Assist por defecto; Alexa y Google hay que elegirlos), alias y «Exponer todos los de esta sala».
 */
export function AssistantsSection({ device }: { device: Device }) {
  const project = useProjectStore((s) => s.project);
  const updateDevice = useProjectStore((s) => s.updateDevice);
  const update = useProjectStore((s) => s.update);
  const aliasId = useId();
  const def = definitionOf(device);
  if (!def) return null;
  const room = project.rooms.find((r) => r.id === device.roomId);
  const isAssistant = def.assistant !== undefined;
  const exposeAll = (target: VoiceTarget) => {
    if (!device.roomId) return;
    const changes = new Map(exposeRoom(project, knownDefinitions(), device.roomId, target));
    if (changes.size === 0) return;
    update((p) => ({ ...p, devices: p.devices.map((d) => (changes.has(d.id) ? { ...d, exposedTo: changes.get(d.id) ?? [] } : d)) }));
  };
  return (
    <section aria-label="Asistentes" className="flex flex-col gap-1.5" data-testid="assistants-section">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Asistentes</h3>
      {isAssistant ? (
        <>
          <p className="text-xs text-slate-600">Es un asistente de voz ({ASSISTANT_LABELS[def.assistant?.kind ?? 'assist']}): lo que entiende depende de lo expuesto en cada dispositivo.</p>
          {(def.assistant?.kind === 'alexa' || def.assistant?.kind === 'google') && (
            <label className="flex flex-col gap-0.5 text-xs text-slate-600">
              Enlace de {ASSISTANT_LABELS[def.assistant.kind]} con Home Assistant
              <select
                className={inputClass}
                value={project.voiceLinks?.[def.assistant.kind] ?? 'nabu_casa'}
                onChange={(e) => {
                  const kind = def.assistant?.kind === 'alexa' ? 'alexa' : 'google';
                  const value = e.target.value === 'manual' ? 'manual' : 'nabu_casa';
                  update((p) => ({ ...p, voiceLinks: { ...p.voiceLinks, [kind]: value } }));
                }}
              >
                <option value="nabu_casa">Home Assistant Cloud (Nabu Casa, de pago)</option>
                <option value="manual">Configuración manual (YAML y HTTPS público, gratis)</option>
              </select>
            </label>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap gap-3" role="group" aria-label="Exponer a">
            {TARGETS.map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={isExposed(device, t)}
                  onChange={(e) => updateDevice(device.id, { exposedTo: toggleExposure(device, t, e.target.checked) })}
                  className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                {ASSISTANT_LABELS[t]}
              </label>
            ))}
          </div>
          <label htmlFor={aliasId} className="text-xs font-medium text-slate-600">
            Alias (separados por comas)
          </label>
          <input
            id={aliasId}
            className={inputClass}
            defaultValue={(device.aliases ?? []).join(', ')}
            placeholder="lámpara de pie, luz grande"
            onBlur={(e) => {
              const list = e.target.value.split(',').map((x) => x.trim()).filter((x) => x !== '');
              updateDevice(device.id, { aliases: list.length > 0 ? list : undefined });
            }}
          />
          {room && (
            <div className="flex flex-wrap gap-1 text-xs">
              <span className="text-slate-600">Exponer todos los de «{room.name}» a:</span>
              {TARGETS.map((t) => (
                <button key={t} type="button" className="rounded border border-slate-300 px-1.5 hover:bg-slate-50" onClick={() => exposeAll(t)}>
                  {ASSISTANT_LABELS[t]}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500">Alexa y Google necesitan Home Assistant Cloud (de pago) o la configuración manual con HTTPS público, y siempre Internet.</p>
        </>
      )}
    </section>
  );
}

/** Robot aspirador: salas de su mapa (segmentos 16, 17...) en orden de limpieza. */
export function VacuumRoomsSection({ device }: { device: Device }) {
  const project = useProjectStore((s) => s.project);
  const updateDevice = useProjectStore((s) => s.updateDevice);
  const def = definitionOf(device);
  if (def?.category !== 'vacuum') return null;
  const floorRooms = project.rooms.filter((r) => r.floorId === device.floorId);
  const chosen = device.vacuumRooms ?? floorRooms.map((r) => r.id);
  const segments = new Map(vacuumRooms(project, device).map((r) => [r.id, r]));
  const set = (ids: string[]) => updateDevice(device.id, { vacuumRooms: ids });
  return (
    <section aria-label="Mapa del robot" className="flex flex-col gap-1" data-testid="vacuum-rooms">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Mapa del robot</h3>
      {floorRooms.length === 0 && <p className="text-xs text-slate-500">Dibuja salas en esta planta para que el robot las limpie.</p>}
      <ul className="flex flex-col gap-0.5 text-sm">
        {floorRooms.map((r) => {
          const seg = segments.get(r.id);
          return (
            <li key={r.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={`Limpiar ${r.name}`}
                checked={chosen.includes(r.id)}
                onChange={(e) => set(e.target.checked ? [...chosen, r.id] : chosen.filter((x) => x !== r.id))}
                className="h-4 w-4 rounded border-slate-300 text-sky-600"
              />
              <span className="flex-1">{r.name}</span>
              {seg && (
                <span className="text-xs tabular-nums text-slate-500">
                  segmento {seg.segment} · {String(seg.areaM2).replace('.', ',')} m²
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {device.vacuumRooms !== undefined && (
        <button type="button" className="self-start text-xs text-sky-700 underline" onClick={() => updateDevice(device.id, { vacuumRooms: undefined })}>
          Usar todas las salas de la planta
        </button>
      )}
    </section>
  );
}
