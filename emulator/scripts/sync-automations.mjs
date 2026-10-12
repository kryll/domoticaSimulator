#!/usr/bin/env node
// Exporta las automatizaciones, escenas, scripts y grupos (y los helpers, cuando existan) del
// proyecto como packages en ha-config/packages/hasim/ y recarga HA (homeassistant.reload_all
// por WebSocket). El orquestador ya lo hace solo cuando «automatizaciones en HA» está activo;
// este script sirve para forzarlo a mano.
//   node scripts/sync-automations.mjs [--project proyecto.json]
// Sin --project usa el último proyecto que la app mandó al orquestador (GET /project).
// Variables: ORCHESTRATOR_HTTP, HA_URL, HA_CONFIG_DIR, SECRETS_DIR, LAB_TOKEN (si no, de emulator/.env).
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { labToken } from './labEnv.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const args = process.argv.slice(2);
const fileArg = args.indexOf('--project') >= 0 ? args[args.indexOf('--project') + 1] : undefined;

async function loadProject() {
  if (fileArg) {
    const project = JSON.parse(await readFile(fileArg, 'utf8'));
    const catalog = JSON.parse(await readFile(join(here, '..', '..', 'data', 'devices.json'), 'utf8'));
    const defs = Array.isArray(catalog) ? catalog : catalog.devices;
    return { project, definitions: defs };
  }
  const url = `${env.ORCHESTRATOR_HTTP ?? 'http://127.0.0.1:8081'}/project`;
  // GET /project exige el token del laboratorio.
  const res = await fetch(url, { headers: { authorization: `Bearer ${await labToken()}` } });
  if (res.status === 401) throw new Error('El orquestador rechaza el token (LAB_TOKEN de emulator/.env)');
  if (!res.ok) throw new Error(`El orquestador no tiene proyecto (${res.status}): conecta la app al laboratorio o usa --project`);
  return res.json();
}

const { syncAutomations } = await tsImport('../orchestrator/src/haSync.ts', import.meta.url);
try {
  const { project, definitions } = await loadProject();
  const result = await syncAutomations(project, definitions, {
    haConfigDir: env.HA_CONFIG_DIR ?? join(here, '..', 'ha-config'),
    haUrl: env.HA_URL ?? 'http://127.0.0.1:8123',
    secretsDir: env.SECRETS_DIR ?? join(here, '..', '.secrets'),
  });
  console.log(`Packages escritos: ${result.files.join(', ') || 'ninguno'}`);
  console.log(result.reloaded ? 'Home Assistant recargado (homeassistant.reload_all)' : 'Sin token de HA: ejecuta onboard-ha.mjs y recarga a mano');
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
