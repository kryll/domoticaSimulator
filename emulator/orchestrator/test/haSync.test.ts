import { describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncAutomations, writePackages } from '../src/haSync';
import { createDemoProject } from '../../../src/store/demoProject';
import { catalog } from '../../../src/devices/catalog';

describe('sincronización de automatizaciones con HA', () => {
  it('escribe packages/hasim/<área>.yaml y borra los anteriores', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hasim-pk-'));
    await mkdir(join(dir, 'packages', 'hasim'), { recursive: true });
    await writeFile(join(dir, 'packages', 'hasim', 'viejo.yaml'), 'x: 1');
    const files = await writePackages(createDemoProject(), catalog, dir);
    expect(files.length).toBeGreaterThan(0);
    const names = await readdir(join(dir, 'packages', 'hasim'));
    expect(names).not.toContain('viejo.yaml');
    expect(names).toContain('salon.yaml');
    const salon = await readFile(join(dir, 'packages', 'hasim', 'salon.yaml'), 'utf8');
    expect(salon).toMatch(/automation:/);
  });

  it('sin token solo escribe los archivos', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hasim-pk-'));
    const r = await syncAutomations(createDemoProject(), catalog, { haConfigDir: dir, haUrl: 'http://127.0.0.1:1', secretsDir: join(dir, 'nada') });
    expect(r.reloaded).toBe(false);
    expect(r.files.length).toBeGreaterThan(0);
  });
});
