import { useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { TextField } from '../ui/Field';
import { readFileAsDataUrl } from '../ui/download';
import { cx } from '../ui/cx';
import type { Floor } from '../types';

function FloorDialog({ floorId, onClose }: { floorId: string; onClose: () => void }) {
  const floor = useProjectStore((s) => s.project.floors.find((f) => f.id === floorId));
  if (!floor) return null;
  return <FloorDialogBody floor={floor} onClose={onClose} />;
}

function FloorDialogBody({ floor, onClose }: { floor: Floor; onClose: () => void }) {
  const updateFloor = useProjectStore((s) => s.updateFloor);
  const removeFloor = useProjectStore((s) => s.removeFloor);
  const floorCount = useProjectStore((s) => s.project.floors.length);
  const [name, setName] = useState(floor.name);
  const [ppm, setPpm] = useState(String(floor.pixelsPerMeter));
  const fileRef = useRef<HTMLInputElement>(null);

  const save = () => {
    const pixelsPerMeter = Number(ppm);
    updateFloor(floor.id, {
      name: name.trim() || floor.name,
      pixelsPerMeter: Number.isFinite(pixelsPerMeter) && pixelsPerMeter > 0 ? pixelsPerMeter : floor.pixelsPerMeter,
    });
    onClose();
  };

  return (
    <Modal
      open
      title="Propiedades de la planta"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="danger"
            disabled={floorCount <= 1}
            onClick={() => {
              if (window.confirm(`¿Eliminar la planta "${floor.name}" con sus salas y dispositivos?`)) {
                removeFloor(floor.id);
                useUiStore.getState().setActiveFloor(null);
                onClose();
              }
            }}
          >
            Eliminar planta
          </Button>
          <Button variant="primary" onClick={save}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField label="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="Escala (píxeles por metro)"
          type="number"
          min={1}
          value={ppm}
          onChange={(e) => setPpm(e.target.value)}
          hint="Se usa para calcular la cobertura de radio."
        />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Imagen de fondo del plano</span>
          {floor.backgroundImage && (
            <img src={floor.backgroundImage} alt="Plano actual" className="max-h-32 rounded border object-contain" />
          )}
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              aria-label="Seleccionar imagen del plano"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const dataUrl = await readFileAsDataUrl(file);
                updateFloor(floor.id, { backgroundImage: dataUrl });
                e.target.value = '';
              }}
            />
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              Subir imagen…
            </Button>
            {floor.backgroundImage && (
              <Button size="sm" variant="danger" onClick={() => updateFloor(floor.id, { backgroundImage: undefined })}>
                Quitar imagen
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Selector de plantas del proyecto. */
export function FloorBar() {
  const floors = useProjectStore((s) => s.project.floors);
  const addFloor = useProjectStore((s) => s.addFloor);
  const activeFloorId = useUiStore((s) => s.activeFloorId);
  const setActiveFloor = useUiStore((s) => s.setActiveFloor);
  const [editing, setEditing] = useState<string | null>(null);
  const sorted = [...floors].sort((a, b) => a.level - b.level);
  const current = floors.find((f) => f.id === activeFloorId) ?? floors[0];

  return (
    <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1" role="toolbar" aria-label="Plantas">
      <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Plantas</span>
      {sorted.map((f) => (
        <button
          key={f.id}
          type="button"
          aria-pressed={current?.id === f.id}
          onClick={() => setActiveFloor(f.id)}
          onDoubleClick={() => setEditing(f.id)}
          className={cx(
            'rounded-md px-2 py-0.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
            current?.id === f.id ? 'bg-white font-semibold text-sky-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white',
          )}
        >
          {f.name}
        </button>
      ))}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          const floor = addFloor(`Planta ${floors.length + 1}`);
          setActiveFloor(floor.id);
        }}
        aria-label="Añadir planta"
        title="Añadir planta"
      >
        + Planta
      </Button>
      {current && (
        <Button size="sm" variant="ghost" onClick={() => setEditing(current.id)} title="Renombrar, escala y plano de fondo">
          Editar planta
        </Button>
      )}
      {editing && <FloorDialog floorId={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
