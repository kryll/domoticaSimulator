import { useState } from 'react';
import { useProjectStore, projectSettings } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import { parseMoneyInput } from '../ui/money';
import { SPANISH_CITIES, TIME_ZONES } from './cities';

function parseCoord(text: string, limit: number): number | undefined {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) && Math.abs(n) <= limit ? n : undefined;
}

/** Diálogo «Ajustes del proyecto»: ubicación (para el sol), zona horaria y precio del kWh. */
export function ProjectSettingsDialog() {
  const close = () => useUiStore.getState().setSettingsOpen(false);
  const stored = useProjectStore((s) => s.project.settings);
  const update = useProjectStore((s) => s.updateSettings);
  const current = projectSettings({ settings: stored });
  const [lat, setLat] = useState(String(current.latitude));
  const [lon, setLon] = useState(String(current.longitude));
  const [tz, setTz] = useState(current.timeZone ?? 'Europe/Madrid');
  const [price, setPrice] = useState(String(current.electricityPriceEurKwh).replace('.', ','));

  const latitude = parseCoord(lat, 90);
  const longitude = parseCoord(lon, 180);
  const kwh = parseMoneyInput(price);
  const valid = latitude !== undefined && longitude !== undefined && kwh !== undefined;
  const preset = SPANISH_CITIES.find((c) => c.latitude === latitude && c.longitude === longitude)?.name ?? '';

  const save = () => {
    if (!valid) return;
    update({ latitude, longitude, timeZone: tz, electricityPriceEurKwh: kwh });
    useUiStore.getState().notify('Ajustes del proyecto guardados', 'success');
    close();
  };

  return (
    <Modal
      open
      title="Ajustes del proyecto"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancelar</Button>
          <Button variant="primary" onClick={save} disabled={!valid}>
            Guardar
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-2">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ubicación</legend>
          <SelectField
            label="Ciudad"
            value={preset}
            placeholder="— Personalizada —"
            options={SPANISH_CITIES.map((c) => ({ value: c.name, label: c.name }))}
            onChange={(e) => {
              const city = SPANISH_CITIES.find((c) => c.name === e.target.value);
              if (!city) return;
              setLat(String(city.latitude));
              setLon(String(city.longitude));
              setTz(city.timeZone);
            }}
          />
          <div className="grid grid-cols-2 gap-2">
            <TextField
              label="Latitud"
              inputMode="decimal"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              aria-invalid={latitude === undefined}
              hint={latitude === undefined ? 'Entre -90 y 90' : undefined}
            />
            <TextField
              label="Longitud"
              inputMode="decimal"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
              aria-invalid={longitude === undefined}
              hint={longitude === undefined ? 'Entre -180 y 180' : undefined}
            />
          </div>
          <SelectField
            label="Zona horaria"
            value={tz}
            options={[...new Set([...TIME_ZONES, tz])].map((z) => ({ value: z, label: z }))}
            onChange={(e) => setTz(e.target.value)}
            hint="Se usa para calcular el amanecer y el atardecer en hora local."
          />
        </fieldset>
        <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-2">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Energía</legend>
          <TextField
            label="Precio de la electricidad (€/kWh)"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            aria-invalid={kwh === undefined}
            hint={kwh === undefined ? 'Introduce un precio válido, p. ej. 0,15' : undefined}
          />
        </fieldset>
      </form>
    </Modal>
  );
}
