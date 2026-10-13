// Lee el token del laboratorio para los scripts del host (e2e, sync-automations): la variable
// LAB_TOKEN o, si no está, la línea LAB_TOKEN= de emulator/.env (la crea setup.sh).
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export async function labToken() {
  const fromEnv = (process.env.LAB_TOKEN ?? '').trim();
  if (fromEnv) return fromEnv;
  try {
    const text = await readFile(join(here, '..', '.env'), 'utf8');
    const line = text.split('\n').find((l) => l.startsWith('LAB_TOKEN='));
    const token = line?.slice('LAB_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
    if (token) return token;
  } catch {
    // sin .env
  }
  throw new Error('Falta el token del laboratorio: define LAB_TOKEN o ejecuta emulator/scripts/setup.sh (lo escribe en emulator/.env)');
}

/**
 * Perfiles del laboratorio (vías reales): la variable E2E_PROFILES o COMPOSE_PROFILES o, si no
 * están, la línea COMPOSE_PROFILES= de emulator/.env (la escribe setup.sh).
 */
export async function labProfiles() {
  const fromEnv = process.env.E2E_PROFILES ?? process.env.COMPOSE_PROFILES;
  let text = fromEnv;
  if (text === undefined) {
    try {
      const env = await readFile(join(here, '..', '.env'), 'utf8');
      text = env.split('\n').find((l) => l.startsWith('COMPOSE_PROFILES='))?.slice('COMPOSE_PROFILES='.length) ?? '';
    } catch {
      text = '';
    }
  }
  return new Set(text.split(',').map((p) => p.trim()).filter(Boolean));
}
