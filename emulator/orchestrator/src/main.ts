// Punto de entrada de hasim-orchestrator (Node 22 + tsx). Configuración por variables de entorno.
import { Lab } from './lab';
import { startServer } from './server';
import { SnapshotStore } from './snapshots';
import { dockerSocketControl } from './docker';
import { join } from 'node:path';
import { readToken, removePackages, syncAutomations } from './haSync';
import { haApi } from './haNative';
import type { NativeBackend } from './native';
import { ZwaveBackend, wsMockLink } from './zwave/backend';
import { EsphomeBackend } from './esphome/backend';
import { ESPHOME_PORT_BASE } from './esphome/store';
import { ShellyBackend } from './shelly/backend';
import { SHELLY_PORT_BASE } from './shelly/store';
import { MATTER_BRIDGE_PORT, MatterBackend } from './matter/backend';
import type { SnapshotExtra } from './snapshots';

const env = process.env;
const haConfigDir = env.HA_CONFIG_DIR;
const secretsDir = env.SECRETS_DIR ?? '/secrets';
const haUrl = env.HA_URL ?? 'http://127.0.0.1:8123';
const log = (msg: string): void => console.log(`[orquestador] ${msg}`);
const token = (env.LAB_TOKEN ?? '').trim();

// Perfiles del laboratorio (setup.sh --zwave / --esphome / --shelly / --matter los guarda en .env como COMPOSE_PROFILES).
const profiles = new Set((env.HASIM_PROFILES ?? env.COMPOSE_PROFILES ?? '').split(',').map((p) => p.trim()).filter(Boolean));
const containers = dockerSocketControl(env.DOCKER_SOCKET ?? '/var/run/docker.sock');
const ha = haApi(haUrl, () => readToken(secretsDir));
const native: NativeBackend[] = [];
if (profiles.has('zwave')) {
  native.push(
    new ZwaveBackend({
      link: wsMockLink(env.ZWAVE_MOCK_URL ?? 'ws://127.0.0.1:5556', token),
      zjsUrl: env.ZWAVE_JS_URL ?? 'ws://127.0.0.1:3000',
      uiUrl: env.ZWAVE_UI_URL ?? 'http://localhost:8091',
      wakeUpSeconds: Number(env.ZWAVE_WAKEUP_S ?? 120),
      containers,
      uiContainer: env.ZWAVE_UI_CONTAINER ?? 'hasim-zwave-js-ui',
    }),
  );
}
if (profiles.has('esphome')) {
  native.push(
    new EsphomeBackend({
      host: env.ESPHOME_HOST ?? '127.0.0.1',
      portBase: Number(env.ESPHOME_PORT_BASE ?? ESPHOME_PORT_BASE),
      encryption: env.ESPHOME_ENCRYPTION !== '0',
      storeFile: join(secretsDir, 'esphome-nodes.json'),
      ha,
    }),
  );
}
if (profiles.has('shelly')) {
  native.push(
    new ShellyBackend({
      host: env.SHELLY_HOST ?? '127.0.0.1',
      portBase: Number(env.SHELLY_PORT_BASE ?? SHELLY_PORT_BASE),
      storeFile: join(secretsDir, 'shelly-nodes.json'),
      ha,
    }),
  );
}
// Datos de matter.js del bridge (fabrics, números de endpoint): emulator/matter/bridge.
const matterDir = env.MATTER_DATA_DIR ?? join(secretsDir, '..', 'matter', 'bridge');
if (profiles.has('matter')) {
  native.push(
    new MatterBackend({
      serverUrl: env.MATTER_SERVER_URL ?? 'ws://127.0.0.1:5580/ws',
      port: Number(env.MATTER_BRIDGE_PORT ?? MATTER_BRIDGE_PORT),
      storagePath: matterDir,
      secretsFile: join(secretsDir, 'matter.json'),
      dashboardUrl: env.MATTER_DASHBOARD_URL ?? 'http://localhost:5580',
    }),
  );
}
const extras: SnapshotExtra[] = [];
if (env.ZWAVE_DATA_DIR) extras.push({ name: 'zwave', path: env.ZWAVE_DATA_DIR, kind: 'dir' });
extras.push({ name: 'esphome-nodes.json', path: join(secretsDir, 'esphome-nodes.json'), kind: 'file' });
extras.push({ name: 'shelly-nodes.json', path: join(secretsDir, 'shelly-nodes.json'), kind: 'file' });
if (profiles.has('matter')) {
  extras.push({ name: 'matter', path: matterDir, kind: 'dir' });
  extras.push({ name: 'matter.json', path: join(secretsDir, 'matter.json'), kind: 'file' });
}

const lab = new Lab({
  mqttUrl: env.MQTT_URL ?? 'mqtt://127.0.0.1:1883',
  ...(env.MQTT_USERNAME ? { username: env.MQTT_USERNAME } : {}),
  ...(env.MQTT_PASSWORD ? { password: env.MQTT_PASSWORD } : {}),
  autostart: env.HASIM_AUTOSTART !== '0',
  ...(haConfigDir && env.SNAPSHOTS_DIR ? { snapshots: new SnapshotStore(haConfigDir, env.SNAPSHOTS_DIR, extras) } : {}),
  containers,
  haContainer: env.HA_CONTAINER ?? 'hasim-homeassistant',
  extraContainers: profiles.has('zwave') ? ['hasim-zwave-js-ui', 'hasim-zwave-mock'] : [],
  native,
  ha,
  ...(haConfigDir
    ? {
        sync: async (project, defs) => {
          const r = await syncAutomations(project, defs, { haConfigDir, haUrl, secretsDir });
          return `Packages escritos (${r.files.length})${r.reloaded ? ' y HA recargado' : '; sin token de HA, no se ha recargado'}`;
        },
        unsync: async () => {
          const r = await removePackages({ haConfigDir, haUrl, secretsDir });
          if (!r.removed) return undefined;
          return `Packages del lab borrados${r.reloaded ? ' y HA recargado' : '; sin token de HA, no se ha recargado'}`;
        },
      }
    : {}),
  haTokenAvailable: async () => (await readToken(secretsDir)) !== undefined,
  log,
});

const port = Number(env.PORT ?? 8081);
const host = env.HOST ?? '127.0.0.1';
const origins = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

async function main(): Promise<void> {
  if (token.length < 16) throw new Error('Falta LAB_TOKEN (al menos 16 caracteres) en emulator/.env: ejecuta emulator/scripts/setup.sh, que lo genera');
  const server = await startServer(lab, { port, host, origins, token });
  log(`escuchando en http://${host}:${server.port()} (WebSocket en / y /orchestrator)`);
  await lab.start();
  log('conectado a MQTT');
  if (native.length > 0) log(`vías reales activas: ${native.map((b) => b.transport).join(', ')}`);
  const stop = async (): Promise<void> => {
    await lab.close();
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

main().catch((err: unknown) => {
  console.error('[orquestador] no se pudo arrancar:', err);
  process.exit(1);
});
