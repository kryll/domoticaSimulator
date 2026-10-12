import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDemoProject } from '../store/demoProject';
import { base64UrlToBytes, bytesToBase64Url, decodeProjectFromHash, encodeProjectToHash, hasCompressionStreams, shareUrl } from './share';

describe('compartir por URL', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('base64url ida y vuelta', () => {
    const bytes = new Uint8Array([0, 250, 251, 252, 253, 254, 255, 62, 63]);
    const text = bytesToBase64Url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(base64UrlToBytes(text)).toEqual(bytes);
    expect(() => base64UrlToBytes('a+b')).toThrow(/no es válido/);
  });

  it('ida y vuelta sin comprimir (fallback)', async () => {
    const demo = createDemoProject();
    const code = await encodeProjectToHash(demo, { compress: false });
    expect(code.startsWith('v0.')).toBe(true);
    expect(await decodeProjectFromHash(code)).toEqual(demo);
    expect(await decodeProjectFromHash(`#p=${code}`)).toEqual(demo);
  });

  it('sin CompressionStream usa el fallback automáticamente', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    expect(hasCompressionStreams()).toBe(false);
    const code = await encodeProjectToHash(createDemoProject());
    expect(code.startsWith('v0.')).toBe(true);
  });

  it.runIf(hasCompressionStreams())('comprime con deflate y es más corto', async () => {
    const demo = createDemoProject();
    const code = await encodeProjectToHash(demo);
    expect(code.startsWith('v1.')).toBe(true);
    expect(code.length).toBeLessThan((await encodeProjectToHash(demo, { compress: false })).length / 2);
    expect(await decodeProjectFromHash(code)).toEqual(demo);
    const url = await shareUrl('https://ejemplo.test/app#viejo', demo);
    expect(url.startsWith('https://ejemplo.test/app#p=v1.')).toBe(true);
    await expect(decodeProjectFromHash('v1.AAAA')).rejects.toThrow(/dañado/);
  });

  it('quita imágenes y variantes y valida con projectSchema', async () => {
    const demo = createDemoProject();
    const withExtras = { ...demo, floors: demo.floors.map((f) => ({ ...f, backgroundImage: 'data:image/png;base64,AAAA' })), variants: [] };
    const decoded = await decodeProjectFromHash(await encodeProjectToHash(withExtras, { compress: false }));
    expect(decoded.floors[0]?.backgroundImage).toBeUndefined();
    expect(decoded.variants).toBeUndefined();
    const bad = 'v0.' + bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ version: 1 })));
    await expect(decodeProjectFromHash(bad)).rejects.toThrow(/Proyecto no válido/);
    await expect(decodeProjectFromHash('xx')).rejects.toThrow(/formato desconocido/);
    await expect(decodeProjectFromHash('v0.' + bytesToBase64Url(new TextEncoder().encode('{')))).rejects.toThrow(/JSON no válido/);
  });
});

describe('límites al compartir', () => {
  it('rechaza hashes demasiado largos', async () => {
    const { MAX_SHARE_HASH } = await import('./share');
    await expect(decodeProjectFromHash('v0.' + 'A'.repeat(MAX_SHARE_HASH))).rejects.toThrow(/demasiado largo/);
  });

  it.runIf(hasCompressionStreams())('corta una bomba de descompresión a 10 MB', async () => {
    const zeros = new Uint8Array(12 * 1024 * 1024);
    const stream = new CompressionStream('deflate');
    const writer = stream.writable.getWriter();
    void writer.write(zeros).then(() => writer.close());
    const reader = stream.readable.getReader();
    const parts: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const bomb = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      bomb.set(p, off);
      off += p.length;
    }
    expect(bomb.length).toBeLessThan(100_000);
    await expect(decodeProjectFromHash('v1.' + bytesToBase64Url(bomb))).rejects.toThrow(/demasiado grande/);
  });

  it('solo admite imágenes de fondo data:image/…', async () => {
    const demo = createDemoProject();
    const evil = { ...demo, floors: demo.floors.map((f) => ({ ...f, backgroundImage: 'https://ejemplo.test/espia.png' })) };
    const code = await encodeProjectToHash(evil, { compress: false, omitImages: false });
    await expect(decodeProjectFromHash(code)).rejects.toThrow(/data:image/);
    const ok = { ...demo, floors: demo.floors.map((f) => ({ ...f, backgroundImage: 'data:image/png;base64,AAAA' })) };
    const decoded = await decodeProjectFromHash(await encodeProjectToHash(ok, { compress: false, omitImages: false }));
    expect(decoded.floors[0]?.backgroundImage).toBe('data:image/png;base64,AAAA');
  });
});
