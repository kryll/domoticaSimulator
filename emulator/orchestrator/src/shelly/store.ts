// Puertos de los Shelly emulados del laboratorio (18180 + n, estables): se guardan en
// emulator/.secrets/shelly-nodes.json (0600) para que HA encuentre cada Shelly en el mismo puerto
// tras reiniciar el orquestador (su entrada shelly guarda host y puerto).
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Puerto base por defecto. Lejos de los del laboratorio: HA 8123, Caddy 8080, orquestador 8081,
 * Z-Wave JS UI 8091 y 3000, ESPHome 16053+, Matter 5540/5580 (y 18081, el orquestador de pruebas).
 */
export const SHELLY_PORT_BASE = 18180;

export interface ShellyNodeRecord {
  port: number;
}

interface StoreData {
  version: 1;
  nodes: Record<string, ShellyNodeRecord>;
}

export class ShellyNodeStore {
  private data: StoreData = { version: 1, nodes: {} };
  private loaded = false;

  constructor(
    private readonly file: string | undefined,
    private readonly portBase = SHELLY_PORT_BASE,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.file) return;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Partial<StoreData>;
      if (raw && typeof raw.nodes === 'object' && raw.nodes !== null) {
        for (const [id, rec] of Object.entries(raw.nodes)) {
          if (rec && Number.isInteger(rec.port) && rec.port > 0 && rec.port < 65536) this.data.nodes[id] = { port: rec.port };
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

  get(id: string): ShellyNodeRecord | undefined {
    return this.data.nodes[id];
  }

  /** Puerto del nodo (la primera vez, el primer puerto libre desde la base + 1). */
  async ensure(id: string): Promise<ShellyNodeRecord> {
    await this.load();
    const existing = this.data.nodes[id];
    if (existing && existing.port > this.portBase) return existing;
    const used = new Set(Object.entries(this.data.nodes).filter(([k]) => k !== id).map(([, r]) => r.port));
    let port = this.portBase + 1;
    while (used.has(port)) port += 1;
    const rec: ShellyNodeRecord = { port };
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
