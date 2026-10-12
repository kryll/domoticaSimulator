import { useState } from 'react';
import { useProjectStore, projectSettings } from '../store/projectStore';
import { useUiStore, type SettingsTab } from '../store/uiStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { SelectField, TextField } from '../ui/Field';
import { Tabs } from '../ui/Tabs';
import { tabPanelId } from '../ui/ids';
import { parseMoneyInput } from '../ui/money';
import { parseNumberInput } from '../ui/formValues';
import { environmentSettings } from '../simulation/thermal';
import { SPANISH_CITIES, TIME_ZONES } from './cities';

const TABS_PREFIX = 'ajustes';
const TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: 'project', label: 'Proyecto' },
  { key: 'simulation', label: 'Simulación' },
];

const fmt = (n: number): string => String(n).replace('.', ',');

function parseCoord(text: string, limit: number): number | undefined {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(n) && Math.abs(n) <= limit ? n : undefined;
}

/**
 * Diálogo «Ajustes del proyecto», único para todos los ajustes:
 * - Proyecto (Fase 2): ubicación (para el sol real), zona horaria y precio del kWh.
 * - Simulación (Fase 3): modelo térmico, temperatura exterior y latencia. El botón ⚙ de la
 *   barra de simulación abre este mismo diálogo en esa pestaña.
 * Se guarda todo junto (un solo paso de deshacer).
 */
export function ProjectSettingsDialog() {
  const close = () => useUiStore.getState().setSettingsOpen(false);
  const [tab, setTab] = useState<SettingsTab>(() => useUiStore.getState().settingsTab);
  const stored = useProjectStore((s) => s.project.settings);
  const storedEnv = useProjectStore((s) => s.project.environment);
  const storedReliability = useProjectStore((s) => s.project.reliability);
  const current = projectSettings({ settings: stored });
  const env = environmentSettings({ environment: storedEnv });
  const [thermal, setThermal] = useState(env.enabled);
  const [outdoorMean, setOutdoorMean] = useState(fmt(env.outdoorMean));
  const [amplitude, setAmplitude] = useState(fmt(env.outdoorAmplitude));
  const [latency, setLatency] = useState(storedReliability?.latency ?? false);
  const [lat, setLat] = useState(String(current.latitude));
  const [lon, setLon] = useState(String(current.longitude));
  const [tz, setTz] = useState(current.timeZone ?? 'Europe/Madrid');
  const [price, setPrice] = useState(String(current.electricityPriceEurKwh).replace('.', ','));

  const latitude = parseCoord(lat, 90);
  const longitude = parseCoord(lon, 180);
  const kwh = parseMoneyInput(price);
  const mean = parseNumberInput(outdoorMean.replace(',', '.'));
  const amp = parseNumberInput(amplitude.replace(',', '.'));
  const validSim = mean !== undefined && amp !== undefined && amp >= 0;
  const valid = latitude !== undefined && longitude !== undefined && kwh !== undefined && validSim;
  const preset = SPANISH_CITIES.find((c) => c.latitude === latitude && c.longitude === longitude)?.name ?? '';

  const save = () => {
    if (!valid) return;
    useProjectStore.getState().update((p) => {
      let next = { ...p, settings: { ...projectSettings(p), latitude, longitude, timeZone: tz, electricityPriceEurKwh: kwh } };
      if (latency !== (p.reliability?.latency ?? false)) next = { ...next, reliability: { ...p.reliability, latency } };
      // El entorno solo se guarda si se activa o ya existía (los proyectos sin él siguen igual).
      return thermal || p.environment
        ? { ...next, environment: { ...environmentSettings(p), enabled: thermal, outdoorMean: mean, outdoorAmplitude: amp } }
        : next;
    });
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
      <Tabs<SettingsTab> label="Secciones de los ajustes" tabs={TABS} active={tab} onChange={setTab} idPrefix={TABS_PREFIX} className="mb-3 border-b border-slate-200" />
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div role="tabpanel" id={tabPanelId(TABS_PREFIX, 'project')} aria-labelledby={`${TABS_PREFIX}-tab-project`} hidden={tab !== 'project'} className="flex flex-col gap-3">
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
        </div>
        <div role="tabpanel" id={tabPanelId(TABS_PREFIX, 'simulation')} aria-labelledby={`${TABS_PREFIX}-tab-simulation`} hidden={tab !== 'simulation'} className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-2">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Clima</legend>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={thermal} onChange={(e) => setThermal(e.target.checked)} />
              Modelo térmico por sala
            </label>
            <div className="grid grid-cols-2 gap-2">
              <TextField
                label="Temperatura exterior media (°C)"
                inputMode="decimal"
                value={outdoorMean}
                onChange={(e) => setOutdoorMean(e.target.value)}
                aria-invalid={mean === undefined}
                hint={mean === undefined ? 'Introduce un número' : undefined}
              />
              <TextField
                label="Oscilación diaria (± °C)"
                inputMode="decimal"
                value={amplitude}
                onChange={(e) => setAmplitude(e.target.value)}
                aria-invalid={amp === undefined || amp < 0}
                hint={amp === undefined || amp < 0 ? 'Número igual o mayor que 0' : 'Máxima a las 15:00 y mínima a las 03:00.'}
              />
            </div>
            <p className="text-xs text-slate-500">La luz natural de las salas sigue el sol real de la ubicación del proyecto.</p>
          </fieldset>
          <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-2">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Red</legend>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={latency} onChange={(e) => setLatency(e.target.checked)} />
              Latencia según protocolo e integración
            </label>
          </fieldset>
        </div>
      </form>
    </Modal>
  );
}
