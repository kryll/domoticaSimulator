import { useEffect, useState } from 'react';
import { useBridgeStore } from './bridgeStore';
import { testConnection } from './bridgeClient';
import { updateBridgeSettings, useBridgeSettings } from './useBridge';
import { CONNECTION_LABELS, HA_LABELS, OTHER_TAB_MESSAGE, SERVICE_LABELS } from './labels';
import { LAB_TOKEN_RE, ORCHESTRATOR_URL_RE, useLocalLab } from './localLab';
import { topicError } from './schema';
import { TRANSPORT_LABELS } from './via';
import { Button } from '../ui/Button';
import { inputClass } from '../ui/Field';
import type { AutomationsRunIn, DeviceTransport, HaBridgeSettings } from '../types';

type TopicKey = 'discoveryPrefix' | 'baseTopic' | 'z2mBaseTopic';
const TOPIC_LABELS: Record<TopicKey, string> = { discoveryPrefix: 'Prefijo de discovery', baseTopic: 'Topic base', z2mBaseTopic: 'Topic base Z2M' };

/** Campo de topic MQTT con la misma validación que el proyecto (parseHaBridge) y el error visible. */
function TopicInput({ name, settings }: { name: TopicKey; settings: HaBridgeSettings }) {
  const current = settings[name];
  const [value, setValue] = useState(current);
  useEffect(() => setValue(current), [current]);
  const error = topicError(value.trim());
  return (
    <label className="flex flex-col gap-1 text-slate-600">
      {TOPIC_LABELS[name]}
      <input
        className={inputClass}
        value={value}
        spellCheck={false}
        aria-invalid={error !== undefined}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          const v = value.trim();
          if (topicError(v) === undefined && v !== settings[name]) updateBridgeSettings({ [name]: v });
        }}
      />
      {error !== undefined && (
        <span role="alert" className="text-red-700">
          No se guarda: {error}
        </span>
      )}
    </label>
  );
}

export const HA_URL = 'http://localhost:8123';

/** URL del orquestador en el mismo origen (la app servida por Caddy en el lab). */
function sameOriginUrl(): string | undefined {
  if (typeof window === 'undefined' || !/^https?:$/.test(window.location.protocol)) return undefined;
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/orchestrator`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}

/**
 * Pestaña «Laboratorio» de los ajustes: conexión con el orquestador, estado de los servicios y
 * de los transportes, dónde se ejecutan las automatizaciones y cómo arrancar el entorno. Los
 * cambios se aplican al momento (no esperan al botón Guardar del diálogo).
 */
export function LabSettingsPanel() {
  const settings = useBridgeSettings();
  const local = useLocalLab();
  const connection = useBridgeStore((s) => s.connection);
  const status = useBridgeStore((s) => s.status);
  const lastError = useBridgeStore((s) => s.lastError);
  const [url, setUrl] = useState(local.orchestratorUrl);
  const [token, setToken] = useState(local.token);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => setUrl(local.orchestratorUrl), [local.orchestratorUrl]);
  useEffect(() => setToken(local.token), [local.token]);
  const urlValid = ORCHESTRATOR_URL_RE.test(url.trim());
  const tokenValid = LAB_TOKEN_RE.test(token.trim());
  const commitUrl = () => {
    if (urlValid && url.trim() !== local.orchestratorUrl) local.update({ orchestratorUrl: url.trim() });
  };
  const commitToken = () => {
    if (tokenValid && token.trim() !== local.token) local.update({ token: token.trim() });
  };
  const same = sameOriginUrl();
  const runTest = async () => {
    setTesting(true);
    setTest(await testConnection(url.trim(), token.trim()));
    setTesting(false);
  };
  const transports = Object.entries(status?.transports ?? {}) as Array<[DeviceTransport, { devices: number; status: 'active' | 'pending' }]>;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-slate-600">
        El laboratorio es un entorno de pruebas en tu PC (Docker, software libre y sin conexión a Internet) con un Home Assistant real: los dispositivos del proyecto aparecen en él y el simulador
        hace de mundo físico. Nunca es una instalación real.
      </p>
      <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-2">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Esta máquina</legend>
        <p className="text-xs text-slate-500">
          Estos ajustes se guardan solo en este navegador (no van en el proyecto, ni en la exportación, ni en los enlaces compartidos).
        </p>
        <label className="flex items-center gap-2 text-slate-700">
          <input type="checkbox" checked={local.enabled} onChange={(e) => local.update({ enabled: e.target.checked })} />
          Conectar con el laboratorio
        </label>
        {connection === 'other_tab' && (
          <p role="status" className="text-xs font-medium text-amber-900">
            {OTHER_TAB_MESSAGE}.
          </p>
        )}
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          URL del orquestador (WebSocket)
          <input
            className={inputClass}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={commitUrl}
            aria-invalid={!urlValid}
            spellCheck={false}
          />
          {!urlValid && <span className="text-red-700">Debe empezar por ws:// o wss://</span>}
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Token del laboratorio (LAB_TOKEN de emulator/.env)
          <input
            className={inputClass}
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onBlur={commitToken}
            aria-invalid={token !== '' && !tokenValid}
            spellCheck={false}
          />
          {token !== '' && !tokenValid && <span className="text-red-700">El token tiene al menos 16 caracteres: letras, números, «-» o «_».</span>}
          {token === '' && <span className="text-slate-500">Lo genera emulator/scripts/setup.sh y lo muestra al terminar. Sin él, el orquestador rechaza la conexión.</span>}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void runTest()} disabled={!urlValid || !tokenValid || testing}>
            {testing ? 'Probando…' : 'Probar conexión'}
          </Button>
          {same && same !== url && (
            <Button size="sm" variant="ghost" onClick={() => local.update({ orchestratorUrl: same })}>
              Usar este origen ({same})
            </Button>
          )}
          {test && (
            <span role="status" className={test.ok ? 'text-xs text-emerald-700' : 'text-xs text-red-700'}>
              {test.message}
            </span>
          )}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-2">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Proyecto</legend>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          Automatizaciones, escenas y scripts
          <select
            className={inputClass}
            value={settings.automationsRunIn}
            onChange={(e) => updateBridgeSettings({ automationsRunIn: e.target.value as AutomationsRunIn })}
          >
            <option value="home_assistant">Se ejecutan en el HA del lab (se exportan como packages; el simulador no las dispara)</option>
            <option value="simulator">Se ejecutan en el simulador (HA solo ve los dispositivos)</option>
          </select>
        </label>
        <button type="button" className="self-start text-xs text-sky-800 underline" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
          {advanced ? 'Ocultar topics MQTT' : 'Topics MQTT…'}
        </button>
        {advanced && (
          <div className="grid grid-cols-3 gap-2 text-xs">
            {(['discoveryPrefix', 'baseTopic', 'z2mBaseTopic'] as const).map((key) => (
              <TopicInput key={key} name={key} settings={settings} />
            ))}
            <p className="col-span-3 text-slate-500">Si los cambias, ajusta también la ACL de Mosquitto (emulator/mosquitto/acl).</p>
          </div>
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-2">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Estado</legend>
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
          <Row label="Orquestador" value={CONNECTION_LABELS[connection]} />
          <Row label="Mosquitto" value={status ? SERVICE_LABELS[status.mqtt] : '—'} />
          <Row label="Home Assistant" value={status ? HA_LABELS[status.ha] : '—'} />
          {transports.map(([t, info]) => (
            <Row key={t} label={TRANSPORT_LABELS[t]} value={`${info.devices} dispositivo${info.devices === 1 ? '' : 's'}${info.status === 'pending' ? ' · pendiente: ahora por MQTT genérico' : ''}`} />
          ))}
          {lastError && <Row label="Último error" value={lastError} />}
        </dl>
        <div className="flex flex-wrap gap-2">
          <a className="text-xs font-medium text-sky-800 underline" href={HA_URL} target="_blank" rel="noreferrer">
            Abrir Home Assistant
          </a>
          <Button size="sm" variant="ghost" onClick={() => useBridgeStore.getState().setPanel(true, 'nodes')}>
            Abrir el panel del laboratorio (nodos, tráfico y snapshots)
          </Button>
        </div>
      </fieldset>
      <details className="rounded-md border border-slate-200 p-2 text-xs text-slate-700">
        <summary className="cursor-pointer font-semibold">Cómo arrancar el laboratorio (Linux con Docker)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Instala Docker Engine (gratuito) y Node.js 22.</li>
          <li>
            En la carpeta del proyecto: <code>emulator/scripts/setup.sh</code>. Genera las contraseñas, compila la app, descarga las imágenes la primera vez y arranca Home Assistant,
            Mosquitto, Caddy y el orquestador.
          </li>
          <li>
            Abre la app en <code>http://localhost:8080</code> y Home Assistant en <code>http://localhost:8123</code> (usuario y contraseña en <code>emulator/.env</code>).
          </li>
          <li>Activa «Conectar con el laboratorio» aquí y pega el token que muestra setup.sh (LAB_TOKEN de <code>emulator/.env</code>). Para parar: <code>emulator/scripts/stop.sh</code>.</li>
        </ol>
        <p className="mt-1 text-slate-500">Necesita unos 2 GB de RAM libres y unos 5 GB de disco. Una vez descargadas las imágenes funciona sin Internet.</p>
      </details>
    </div>
  );
}
