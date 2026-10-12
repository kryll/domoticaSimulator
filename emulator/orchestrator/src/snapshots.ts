// Snapshots del laboratorio: copia de ha-config (sin base de datos ni logs) y del proyecto.
//
// Qué se incluye: todo ha-config/ (configuration.yaml, packages/, .storage/ con el registro de
// dispositivos, entidades, áreas, usuarios y la entrada MQTT, secrets.yaml...) salvo:
//   - la base de datos del historial (home-assistant_v2.db y sus -wal/-shm),
//   - los logs (*.log, *.log.N, *.log.fault),
//   - las cachés regenerables (deps/, tts/, .cache/, backups/).
// Junto a la copia se guardan project.json (el proyecto del simulador) y meta.json.
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import type { Project } from '../../../src/types';
import type { SnapshotInfo } from '../../../src/bridge/protocol';

const EXCLUDED_DIRS = new Set(['deps', 'tts', '.cache', 'backups']);

/** ¿Se excluye esta ruta (relativa a ha-config) del snapshot? */
export function excludedFromSnapshot(rel: string): boolean {
  if (rel === '') return false;
  const parts = rel.split(/[\\/]/);
  if (parts.length > 0 && EXCLUDED_DIRS.has(parts[0] ?? '')) return true;
  const name = basename(rel);
  if (/^home-assistant_v2\.db/.test(name)) return true;
  if (/\.log(\.\d+|\.fault)?$/.test(name)) return true;
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

export class SnapshotStore {
  constructor(
    private readonly haConfigDir: string,
    private readonly snapshotsDir: string,
  ) {}

  async list(): Promise<SnapshotInfo[]> {
    await mkdir(this.snapshotsDir, { recursive: true });
    const out: SnapshotInfo[] = [];
    for (const entry of await readdir(this.snapshotsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const meta = JSON.parse(await readFile(join(this.snapshotsDir, entry.name, 'meta.json'), 'utf8')) as SnapshotInfo;
        out.push({ ...meta, id: entry.name });
      } catch {
        // Carpeta sin meta.json: no es un snapshot.
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(name: string, project: Project | undefined, now = new Date()): Promise<SnapshotInfo> {
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const id = `${stamp}-${slug(name)}`;
    const target = join(this.snapshotsDir, id);
    await mkdir(target, { recursive: true });
    const haTarget = join(target, 'ha-config');
    await mkdir(haTarget, { recursive: true });
    await cp(this.haConfigDir, haTarget, {
      recursive: true,
      filter: (src) => !excludedFromSnapshot(relative(this.haConfigDir, src)),
    });
    if (project) await writeFile(join(target, 'project.json'), JSON.stringify(project, null, 2));
    const info: SnapshotInfo = {
      id,
      name: name.trim() || 'Snapshot',
      createdAt: now.toISOString(),
      bytes: await dirSize(haTarget),
      ...(project ? { projectName: project.name } : {}),
    };
    await writeFile(join(target, 'meta.json'), JSON.stringify(info, null, 2));
    return info;
  }

  private dirOf(id: string): string {
    if (id.includes('/') || id.includes('\\') || id.includes('..') || id.includes(sep)) throw new Error(`Snapshot no válido: ${id}`);
    return join(this.snapshotsDir, id);
  }

  /**
   * Restaura ha-config desde el snapshot (conserva la base de datos y los logs actuales) y
   * devuelve el proyecto guardado. HA debe estar parado o reiniciarse justo después.
   */
  async restore(id: string): Promise<Project | undefined> {
    const dir = this.dirOf(id);
    const source = join(dir, 'ha-config');
    await stat(source);
    for (const entry of await readdir(this.haConfigDir)) {
      if (excludedFromSnapshot(entry)) continue;
      await rm(join(this.haConfigDir, entry), { recursive: true, force: true });
    }
    await cp(source, this.haConfigDir, { recursive: true });
    try {
      return JSON.parse(await readFile(join(dir, 'project.json'), 'utf8')) as Project;
    } catch {
      return undefined;
    }
  }

  async remove(id: string): Promise<void> {
    await rm(this.dirOf(id), { recursive: true, force: true });
  }
}
