// Snapshots del laboratorio: copia de ha-config (sin base de datos ni logs) y del proyecto.
//
// Qué se incluye: todo ha-config/ (configuration.yaml, packages/, .storage/ con el registro de
// dispositivos, entidades, áreas, usuarios y la entrada MQTT, secrets.yaml...) salvo:
//   - la base de datos del historial (home-assistant_v2.db y sus -wal/-shm),
//   - los logs (*.log, *.log.N, *.log.fault),
//   - las cachés regenerables (deps/, tts/, .cache/, backups/),
//   - con «Excluir credenciales», .storage/auth* (usuarios, contraseñas y tokens de HA).
// Junto a la copia se guardan project.json (el proyecto del simulador) y meta.json. Con los perfiles
// de E2 también van los datos de las vías reales («extras»): la carpeta de Z-Wave JS UI y del mock
// (emulator/zwave/), los puertos y claves de los nodos ESPHome (.secrets/esphome-nodes.json) y los
// puertos de los Shelly emulados (.secrets/shelly-nodes.json).
//
// SECRETOS: un snapshot contiene usuarios y tokens de HA (.storage/auth*) y las credenciales de
// las integraciones (.storage/core.config_entries, p. ej. la contraseña MQTT). Por eso la carpeta
// de snapshots y cada snapshot son 0700 y los archivos 0600.
import { chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import type { Project } from '../../../src/types';
import type { SnapshotInfo } from '../../../src/bridge/protocol';

const EXCLUDED_DIRS = new Set(['deps', 'tts', '.cache', 'backups']);

/** Ids de snapshot: solo [A-Za-z0-9._-], nunca «.» ni «..» (sin rutas). */
export const SNAPSHOT_ID_RE = /^[A-Za-z0-9._-]+$/;

export function validSnapshotId(id: unknown): id is string {
  return typeof id === 'string' && id.length <= 200 && SNAPSHOT_ID_RE.test(id) && id !== '.' && id !== '..';
}

/** ¿Es un archivo de credenciales de HA (.storage/auth, auth_provider.homeassistant...)? */
export function isCredentialFile(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  return parts.length === 2 && parts[0] === '.storage' && (parts[1] ?? '').startsWith('auth');
}

/** ¿Se excluye esta ruta (relativa a ha-config) del snapshot? */
export function excludedFromSnapshot(rel: string, excludeCredentials = false): boolean {
  if (rel === '') return false;
  const parts = rel.split(/[\\/]/);
  if (parts.length > 0 && EXCLUDED_DIRS.has(parts[0] ?? '')) return true;
  const name = basename(rel);
  if (/^home-assistant_v2\.db/.test(name)) return true;
  if (/\.log(\.\d+|\.fault)?$/.test(name)) return true;
  if (excludeCredentials && isCredentialFile(rel)) return true;
  return false;
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(p);
    else if (entry.isFile()) total += (await stat(p)).size;
  }
  return total;
}

/** Carpetas 0700 y archivos 0600 (solo el propietario). */
async function restrict(path: string): Promise<void> {
  const st = await stat(path);
  if (st.isDirectory()) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path)) await restrict(join(path, entry));
  } else if (st.isFile()) await chmod(path, 0o600);
}

function slug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'snapshot'
  );
}

/** Datos extra del laboratorio que van en el snapshot (carpeta o fichero). */
export interface SnapshotExtra {
  /** Nombre dentro del snapshot ([a-z0-9._-]). */
  name: string;
  /** Ruta absoluta de la carpeta o del fichero. */
  path: string;
  kind: 'dir' | 'file';
}

export interface CreateOptions {
  /** No copia .storage/auth* (usuarios, contraseñas y tokens de HA). */
  excludeCredentials?: boolean;
  now?: Date;
}

export class SnapshotStore {
  constructor(
    private readonly haConfigDir: string,
    private readonly snapshotsDir: string,
    private readonly extras: readonly SnapshotExtra[] = [],
  ) {}

  /** ¿Lleva datos extra (Z-Wave, ESPHome)? Restaurarlos exige parar sus servicios. */
  get hasExtras(): boolean {
    return this.extras.length > 0;
  }

  private async copyExtras(target: string): Promise<void> {
    const dir = join(target, 'extras');
    for (const extra of this.extras) {
      try {
        await stat(extra.path);
      } catch {
        continue; // Perfil sin usar todavía.
      }
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await cp(extra.path, join(dir, extra.name), { recursive: extra.kind === 'dir' });
    }
  }

  private async restoreExtras(source: string): Promise<void> {
    for (const extra of this.extras) {
      const from = join(source, 'extras', extra.name);
      try {
        await stat(from);
      } catch {
        continue; // El snapshot no lo tenía: se deja lo actual.
      }
      if (extra.kind === 'dir') {
        await mkdir(extra.path, { recursive: true });
        for (const entry of await readdir(extra.path)) await rm(join(extra.path, entry), { recursive: true, force: true });
        await cp(from, extra.path, { recursive: true });
      } else {
        await mkdir(join(extra.path, '..'), { recursive: true });
        await cp(from, extra.path);
        await chmod(extra.path, 0o600);
      }
    }
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.snapshotsDir, { recursive: true, mode: 0o700 });
    await chmod(this.snapshotsDir, 0o700);
  }

  async list(): Promise<SnapshotInfo[]> {
    await this.ensureRoot();
    const out: SnapshotInfo[] = [];
    for (const entry of await readdir(this.snapshotsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !validSnapshotId(entry.name)) continue;
      try {
        const meta = JSON.parse(await readFile(join(this.snapshotsDir, entry.name, 'meta.json'), 'utf8')) as SnapshotInfo;
        out.push({ ...meta, id: entry.name });
      } catch {
        // Carpeta sin meta.json: no es un snapshot.
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(name: string, project: Project | undefined, opts: CreateOptions = {}): Promise<SnapshotInfo> {
    const now = opts.now ?? new Date();
    const excludeCredentials = opts.excludeCredentials === true;
    await this.ensureRoot();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const id = `${stamp}-${slug(name)}`;
    const target = join(this.snapshotsDir, id);
    await mkdir(target, { recursive: true, mode: 0o700 });
    const haTarget = join(target, 'ha-config');
    await mkdir(haTarget, { recursive: true, mode: 0o700 });
    await cp(this.haConfigDir, haTarget, {
      recursive: true,
      filter: (src) => !excludedFromSnapshot(relative(this.haConfigDir, src), excludeCredentials),
    });
    if (project) await writeFile(join(target, 'project.json'), JSON.stringify(project, null, 2), { mode: 0o600 });
    await this.copyExtras(target);
    const info: SnapshotInfo = {
      id,
      name: name.trim() || 'Snapshot',
      createdAt: now.toISOString(),
      bytes: await dirSize(haTarget),
      credentials: !excludeCredentials,
      ...(project ? { projectName: project.name } : {}),
    };
    await writeFile(join(target, 'meta.json'), JSON.stringify(info, null, 2), { mode: 0o600 });
    await restrict(target);
    return info;
  }

  /**
   * Comprueba un id que llega de la app: formato seguro (sin rutas, ni «.» ni «..») y que sea uno
   * de los snapshots existentes. Devuelve su carpeta.
   */
  async check(id: unknown): Promise<string> {
    if (!validSnapshotId(id)) throw new Error(`Snapshot no válido: ${String(id)}`);
    const known = await this.list();
    const info = known.find((s) => s.id === id);
    if (!info) throw new Error(`No existe el snapshot ${id}`);
    return join(this.snapshotsDir, id);
  }

  /**
   * Restaura ha-config desde el snapshot (conserva la base de datos y los logs actuales) y
   * devuelve el proyecto guardado. Si el snapshot se guardó sin credenciales, se conservan las
   * actuales (.storage/auth*). HA debe estar parado (lo para el orquestador con Docker).
   */
  async restore(id: string): Promise<Project | undefined> {
    const dir = await this.check(id);
    const source = join(dir, 'ha-config');
    await stat(source);
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as SnapshotInfo;
    const keepCredentials = meta.credentials === false;
    // Credenciales actuales que hay que conservar (el snapshot no las trae).
    const kept: Array<{ name: string; data: Buffer }> = [];
    if (keepCredentials) {
      const storage = join(this.haConfigDir, '.storage');
      for (const entry of await readdir(storage).catch(() => [] as string[])) {
        if (isCredentialFile(`.storage/${entry}`)) kept.push({ name: entry, data: await readFile(join(storage, entry)) });
      }
    }
    for (const entry of await readdir(this.haConfigDir)) {
      if (excludedFromSnapshot(entry)) continue;
      await rm(join(this.haConfigDir, entry), { recursive: true, force: true });
    }
    await cp(source, this.haConfigDir, { recursive: true });
    if (kept.length > 0) {
      await mkdir(join(this.haConfigDir, '.storage'), { recursive: true });
      for (const k of kept) await writeFile(join(this.haConfigDir, '.storage', k.name), k.data, { mode: 0o600 });
    }
    await this.restoreExtras(dir);
    try {
      return JSON.parse(await readFile(join(dir, 'project.json'), 'utf8')) as Project;
    } catch {
      return undefined;
    }
  }

  async remove(id: string): Promise<void> {
    const dir = await this.check(id);
    await rm(dir, { recursive: true, force: true });
  }
}
