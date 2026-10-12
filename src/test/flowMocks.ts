// Polyfills que React Flow necesita en jsdom. Importar en los tests que rendericen el lienzo.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const g = globalThis as unknown as Record<string, unknown>;
if (!g.ResizeObserver) g.ResizeObserver = ResizeObserverMock;

if (typeof window !== 'undefined' && !('DOMMatrixReadOnly' in window)) {
  class DOMMatrixReadOnlyMock {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([1-9.])\)/)?.[1];
      this.m22 = scale !== undefined ? Number(scale) : 1;
    }
  }
  g.DOMMatrixReadOnly = DOMMatrixReadOnlyMock;
}

export {};
