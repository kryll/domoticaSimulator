// Datos del bridge Matter del laboratorio: código de configuración (passcode), discriminador y
// UniqueID del bridge, y el nodo que le asignó matterjs-server al comisionarlo. Se guardan en
// emulator/.secrets/matter.json (0600): con el passcode cualquiera de la red podría comisionar el
// bridge mientras no lo esté. Las claves de la fabric las guarda matter.js en su carpeta de datos.
import { randomBytes, randomInt } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface MatterSecrets {
  version: 1;
  /** Setup PIN code (27 bits, sin los valores prohibidos por la especificación). */
  passcode: number;
  /** Discriminador de 12 bits. */
  discriminator: number;
  /** BasicInformation.UniqueID del bridge (así se reconoce en matterjs-server). */
  uniqueId: string;
  /** Nodo que asignó matterjs-server al comisionarlo (si ya lo está). */
  nodeId?: number;
}

/** Passcodes prohibidos (especificación Matter, 5.1.7.1). */
const INVALID_PASSCODES = new Set([0, 11111111, 22222222, 33333333, 44444444, 55555555, 66666666, 77777777, 88888888, 99999999, 12345678, 87654321]);

export function isValidPasscode(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 99999998 && !INVALID_PASSCODES.has(n);
}

export function newSecrets(): MatterSecrets {
  let passcode = 0;
  while (!isValidPasscode(passcode)) passcode = randomInt(1, 99999999);
  return { version: 1, passcode, discriminator: randomInt(0, 4096), uniqueId: `hasim-bridge-${randomBytes(6).toString('hex')}` };
}

function parse(raw: unknown): MatterSecrets | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Partial<Record<keyof MatterSecrets, unknown>>;
  if (typeof r.passcode !== 'number' || !isValidPasscode(r.passcode)) return undefined;
  if (typeof r.discriminator !== 'number' || !Number.isInteger(r.discriminator) || r.discriminator < 0 || r.discriminator > 4095) return undefined;
  if (typeof r.uniqueId !== 'string' || r.uniqueId.length === 0 || r.uniqueId.length > 32) return undefined;
  const nodeId = typeof r.nodeId === 'number' && Number.isSafeInteger(r.nodeId) && r.nodeId > 0 ? r.nodeId : undefined;
  return { version: 1, passcode: r.passcode, discriminator: r.discriminator, uniqueId: r.uniqueId, ...(nodeId !== undefined ? { nodeId } : {}) };
}

export class MatterSecretsStore {
  private data: MatterSecrets | undefined;

  constructor(private readonly file: string | undefined) {}

  /** Lee el fichero o crea uno nuevo (la primera vez). */
  async load(): Promise<MatterSecrets> {
    if (this.data) return this.data;
    if (this.file) {
      try {
        this.data = parse(JSON.parse(await readFile(this.file, 'utf8')));
      } catch {
        // Sin fichero todavía.
      }
    }
    if (!this.data) {
      this.data = newSecrets();
      await this.save();
    }
    return this.data;
  }

  /** Vuelve a leer el fichero (tras restaurar un snapshot). */
  async reload(): Promise<MatterSecrets> {
    this.data = undefined;
    return this.load();
  }

  async update(patch: Partial<Pick<MatterSecrets, 'nodeId'>> & { clearNode?: boolean }): Promise<MatterSecrets> {
    const cur = await this.load();
    const next: MatterSecrets = { version: 1, passcode: cur.passcode, discriminator: cur.discriminator, uniqueId: cur.uniqueId };
    const nodeId = patch.clearNode ? undefined : (patch.nodeId ?? cur.nodeId);
    if (nodeId !== undefined) next.nodeId = nodeId;
    this.data = next;
    await this.save();
    return next;
  }

  private async save(): Promise<void> {
    if (!this.file || !this.data) return;
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.file);
    await chmod(this.file, 0o600).catch(() => undefined);
  }
}
