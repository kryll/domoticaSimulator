// Sincronización con el HA del lab: escribe las automatizaciones, escenas, scripts y grupos del
// proyecto como packages (con el exportador de la app) y recarga la configuración por WebSocket.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type { DeviceDefinition, Project } from '../../../src/types';

interface ExportFile {
  path: string;
  content: string;
}

type PackagesModule = { projectToPackages: (project: Project, defs: DeviceDefinition[]) => ExportFile[] };

/** Carpeta de los packages del lab dentro de ha-config. */
export const PACKAGES_SUBDIR = join('packages', 'hasim');

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Exportador de la app (src/export/packages.ts). Se importa en tiempo de ejecución (tsx) para
 * que el orquestador no dependa en compilación del resto de la app.
 */
async function loadExporter(): Promise<PackagesModule> {
  const path = join(here, '..', '..', '..', 'src', 'export', 'packages.ts');
  return (await import(path)) as PackagesModule;
}

/**
 * Escribe ha-config/packages/hasim/<área>.yaml (borra antes los anteriores). Devuelve las rutas
 * escritas, relativas a ha-config.
 */
export async function writePackages(project: Project, defs: DeviceDefinition[], haConfigDir: string): Promise<string[]> {
  const { projectToPackages } = await loadExporter();
  const dir = join(haConfigDir, PACKAGES_SUBDIR);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const file of projectToPackages(project, defs)) {
    if (!file.path.startsWith('packages/') || !file.path.endsWith('.yaml')) continue;
    const name = file.path.slice('packages/'.length);
    await writeFile(join(dir, name), file.content);
    written.push(join(PACKAGES_SUBDIR, name));
  }
  return written;
}

export async function readToken(secretsDir: string): Promise<string | undefined> {
  try {
    const token = (await readFile(join(secretsDir, 'ha-token'), 'utf8')).trim();
    return token === '' ? undefined : token;
  } catch {
    return undefined;
  }
}

/** Envía un comando por la API WebSocket de HA y espera su resultado. */
export function haWsCall(haUrl: string, token: string, command: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
  const url = `${haUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/api/websocket`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('Home Assistant no responde por WebSocket'));
    }, timeoutMs);
    const done = (fn: () => void): void => {
      clearTimeout(timer);
      ws.close();
      fn();
    };
    ws.on('error', (err) => done(() => reject(err)));
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { type: string; id?: number; success?: boolean; result?: unknown; error?: { message?: string } };
      if (msg.type === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (msg.type === 'auth_invalid') done(() => reject(new Error('Token de Home Assistant no válido')));
      else if (msg.type === 'auth_ok') ws.send(JSON.stringify({ id: 1, ...command }));
      else if (msg.type === 'result' && msg.id === 1) {
        if (msg.success) done(() => resolve(msg.result));
        else done(() => reject(new Error(msg.error?.message ?? 'Error de Home Assistant')));
      }
    });
  });
}

/** Recarga toda la configuración YAML de HA (automatizaciones, escenas, scripts, grupos...). */
export function reloadAll(haUrl: string, token: string): Promise<unknown> {
  return haWsCall(haUrl, token, { type: 'call_service', domain: 'homeassistant', service: 'reload_all' });
}

export function restartHa(haUrl: string, token: string): Promise<unknown> {
  return haWsCall(haUrl, token, { type: 'call_service', domain: 'homeassistant', service: 'restart' }, 10_000);
}

export interface SyncOptions {
  haConfigDir: string;
  haUrl: string;
  secretsDir: string;
}

/** Exporta los packages y recarga HA. Sin token, solo escribe los archivos. */
export async function syncAutomations(project: Project, defs: DeviceDefinition[], opts: SyncOptions): Promise<{ files: string[]; reloaded: boolean }> {
  const files = await writePackages(project, defs, opts.haConfigDir);
  const token = await readToken(opts.secretsDir);
  if (!token) return { files, reloaded: false };
  await reloadAll(opts.haUrl, token);
  return { files, reloaded: true };
}
