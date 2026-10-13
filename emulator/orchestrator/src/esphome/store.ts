// Datos de los nodos ESPHome del laboratorio: puerto de su API (6053 + n, estable) y clave de
// cifrado Noise (32 bytes aleatorios por nodo, en base64). Se guardan en emulator/.secrets/
// esphome-nodes.json (0600): HA guarda la misma clave en su entrada esphome.
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface EspNodeRecord {
  port: number;
  /** Clave Noise en base64 (sin cifrado: no hay clave). */
  key?: string;
}

export interface EspStoreData {
  version: 1;
  nodes: Record<string, EspNodeRecord>;
}

export class EspNodeStore {
  private data: EspStoreData = { version: 1, nodes: {} };
  private loaded = false;

  constructor(
    private readonly file: string | undefined,
    private readonly portBase = 6053,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.file) return;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<EspStoreData>;
      if (raw && typeof raw.nodes === 'object' && raw.nodes !== null) {
        for (const [id, rec] of Object.entries(raw.nodes)) {
          if (rec && Number.isInteger(rec.port) && rec.port > 0 && rec.port < 65536) this.data.nodes[id] = { port: rec.port, ...(typeof rec.key === 'string' ? { key: rec.key } : {}) };
        }
      }
    } catch {
      // Sin fichero todavía.
    }
  }

  /** Vuelve a leer el fichero (tras restaurar un snapshot). */
  async reload(): Promise<void> {
    this.loaded = false;
    this.data = { version: 1, nodes: {} };
    await this.load();
  }

  private async save(): Promise<void> {
    if (!this.file) return;
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.file);
    await chmod(this.file, 0o600).catch(() => undefined);
  }

  get(id: string): EspNodeRecord | undefined {
    return this.data.nodes[id];
  }

  /** Puerto y clave del nodo (los crea la primera vez: el primer puerto libre desde 6053 + 1). */
  async ensure(id: string, encryption: boolean): Promise<EspNodeRecord> {
    await this.load();
    const existing = this.data.nodes[id];
    if (existing && (existing.key !== undefined) === encryption) return existing;
    const used = new Set(Object.entries(this.data.nodes).filter(([k]) => k !== id).map(([, r]) => r.port));
    let port = existing?.port ?? this.portBase + 1;
    while (used.has(port)) port += 1;
    const rec: EspNodeRecord = { port, ...(encryption ? { key: randomBytes(32).toString('base64') } : {}) };
    this.data.nodes[id] = rec;
    await this.save();
    return rec;
  }

  async remove(id: string): Promise<void> {
    await this.load();
    if (!(id in this.data.nodes)) return;
    delete this.data.nodes[id];
    await this.save();
  }
}
