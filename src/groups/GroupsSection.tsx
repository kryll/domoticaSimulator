import { useMemo, useState } from 'react';
import type { EntityGroup, GroupDomain } from '../types';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { projectEntities } from '../canvas/analysis';
import { groupEntityId } from '../simulation/logic';
import { renameEntityRefs, renameGroupMapping } from '../devices/renaming';
import { updateWithRename } from '../store/entityRename';
import { Button } from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import { newId } from '../ui/ids';
import { formatState } from '../canvas/style';

const DOMAIN_LABELS: Record<GroupDomain, string> = { light: 'Luces', switch: 'Interruptores', cover: 'Persianas' };
const EMPTY: EntityGroup[] = [];

function useCandidates(domain: GroupDomain) {
  const project = useProjectStore((s) => s.project);
  return useMemo(() => {
    const rooms = new Map(project.rooms.map((r) => [r.id, r.name]));
    return projectEntities(project)
      .filter((r) => r.entityId.startsWith(`${domain}.`))
      .map((r) => ({ entityId: r.entityId, label: r.device.name, deviceId: r.device.id, room: (r.device.roomId && rooms.get(r.device.roomId)) || 'Sin sala' }));
  }, [project, domain]);
}

function GroupForm({ initial, onDone }: { initial?: EntityGroup; onDone: () => void }) {
  const selectedIds = useUiStore((s) => s.selection);
  const selectionKind = useUiStore((s) => s.selectionKind);
  const [domain, setDomain] = useState<GroupDomain>(initial?.domain ?? 'light');
  const [name, setName] = useState(initial?.name ?? '');
  const candidates = useCandidates(domain);
  const selectedEntities = candidates.filter((c) => selectionKind === 'device' && selectedIds.includes(c.deviceId)).map((c) => c.entityId);
  const [members, setMembers] = useState<string[]>(() => initial?.entityIds ?? selectedEntities);
  const rooms = [...new Set(candidates.map((c) => c.room))].sort((a, b) => a.localeCompare(b, 'es'));
  const toggle = (id: string, on: boolean) => setMembers((m) => (on ? [...new Set([...m, id])] : m.filter((x) => x !== id)));

  const save = () => {
    const clean = name.trim() || `Grupo de ${DOMAIN_LABELS[domain].toLowerCase()}`;
    const valid = members.filter((m) => m.startsWith(`${domain}.`));
    const group: EntityGroup = { id: initial?.id ?? newId('group'), name: clean, domain, entityIds: valid };
    // Si cambia el nombre (o el tipo), cambia light.grupo_<slug>: referencias y simulación al día.
    const project = useProjectStore.getState().project;
    const mapping: Record<string, string> = initial
      ? initial.domain === domain
        ? renameGroupMapping(project, initial.id, clean)
        : { [groupEntityId(initial)]: groupEntityId(group) }
      : {};
    updateWithRename(mapping, (p) => {
      const list = p.groups ?? [];
      const next = { ...p, groups: initial ? list.map((g) => (g.id === initial.id ? group : g)) : [...list, group] };
      return Object.keys(mapping).length > 0 ? renameEntityRefs(next, mapping) : next;
    });
    onDone();
  };

  return (
    <div role="group" aria-label={initial ? `Editar ${initial.name}` : 'Nuevo grupo'} className="flex flex-col gap-2 rounded-md border border-sky-200 bg-sky-50/50 p-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <TextField label="Nombre del grupo" value={name} placeholder="Luces del salón" onChange={(e) => setName(e.target.value)} />
        <SelectField
          label="Tipo"
          value={domain}
          options={(Object.keys(DOMAIN_LABELS) as GroupDomain[]).map((d) => ({ value: d, label: DOMAIN_LABELS[d] }))}
          onChange={(e) => {
            setDomain(e.target.value as GroupDomain);
            setMembers([]);
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" disabled={selectedEntities.length === 0} onClick={() => setMembers((m) => [...new Set([...m, ...selectedEntities])])} title="Añade las entidades del dispositivo seleccionado en el lienzo">
          + Selección del lienzo
        </Button>
        {rooms.map((room) => (
          <Button
            key={room}
            size="sm"
            variant="ghost"
            onClick={() => setMembers((m) => [...new Set([...m, ...candidates.filter((c) => c.room === room).map((c) => c.entityId)])])}
          >
            + {room}
          </Button>
        ))}
      </div>
      {candidates.length === 0 ? (
        <p className="text-xs text-slate-500">No hay entidades de tipo {DOMAIN_LABELS[domain].toLowerCase()} en el proyecto.</p>
      ) : (
        <fieldset className="max-h-40 overflow-auto rounded border border-slate-200 bg-white p-1">
          <legend className="sr-only">Miembros</legend>
          {candidates.map((c) => (
            <label key={c.entityId} className="flex items-center gap-2 px-1 py-0.5 text-sm">
              <input type="checkbox" checked={members.includes(c.entityId)} onChange={(e) => toggle(c.entityId, e.target.checked)} />
              <span>{c.label}</span>
              <span className="text-xs text-slate-500">· {c.room}</span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button size="sm" variant="primary" disabled={members.length === 0} onClick={save}>
          {initial ? 'Guardar grupo' : 'Crear grupo'}
        </Button>
      </div>
    </div>
  );
}

function GroupRow({ group, onEdit }: { group: EntityGroup; onEdit: () => void }) {
  const entityId = groupEntityId(group);
  const state = useSimulationStore((s) => s.sim.entities[entityId]);
  const callService = useSimulationStore((s) => s.callService);
  const cover = group.domain === 'cover';
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5">
      <div className="min-w-[10rem] flex-1">
        <div className="text-sm font-medium text-slate-800">{group.name}</div>
        <code className="text-[11px] text-slate-500">{entityId}</code>
        <span className="ml-2 text-xs text-slate-500">{group.entityIds.length} miembros</span>
      </div>
      <span className="text-xs font-semibold text-slate-700" aria-label={`Estado de ${group.name}`}>
        {formatState(state)}
      </span>
      <Button size="sm" aria-label={`${cover ? 'Abrir' : 'Encender'} ${group.name}`} onClick={() => callService(entityId, cover ? 'open_cover' : 'turn_on')}>
        {cover ? 'Abrir' : 'Encender'}
      </Button>
      <Button size="sm" aria-label={`${cover ? 'Cerrar' : 'Apagar'} ${group.name}`} onClick={() => callService(entityId, cover ? 'close_cover' : 'turn_off')}>
        {cover ? 'Cerrar' : 'Apagar'}
      </Button>
      <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Editar ${group.name}`}>
        ✎
      </Button>
      <Button
        size="sm"
        variant="danger"
        aria-label={`Borrar ${group.name}`}
        onClick={() => useProjectStore.getState().update((p) => ({ ...p, groups: (p.groups ?? []).filter((g) => g.id !== group.id) }))}
      >
        ✕
      </Button>
    </li>
  );
}

/** Sección «Grupos»: grupos de luces, interruptores o persianas (B19). */
export function GroupsSection() {
  const groups = useProjectStore((s) => s.project.groups ?? EMPTY);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <section aria-labelledby="groups-title" className="flex flex-col gap-2">
      <h3 id="groups-title" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Grupos
      </h3>
      {groups.length === 0 && editing !== 'new' && <p className="text-xs text-slate-500">Sin grupos. Agrupa luces, interruptores o persianas para controlarlos a la vez.</p>}
      <ul className="flex flex-col gap-1" aria-label="Grupos">
        {groups.map((g) =>
          editing === g.id ? (
            <li key={g.id}>
              <GroupForm initial={g} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <GroupRow key={g.id} group={g} onEdit={() => setEditing(g.id)} />
          ),
        )}
      </ul>
      {editing === 'new' ? (
        <GroupForm onDone={() => setEditing(null)} />
      ) : (
        <div>
          <Button size="sm" onClick={() => setEditing('new')}>
            + Nuevo grupo
          </Button>
        </div>
      )}
    </section>
  );
}
