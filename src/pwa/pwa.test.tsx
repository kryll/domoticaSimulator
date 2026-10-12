import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { activateWorker, watchForUpdates, type RegistrationLike, type WorkerLike } from './registerSW';
import { usePwaStore } from './pwaStore';
import { UpdatePrompt } from './UpdatePrompt';
import { serviceWorkerSource } from '../../scripts/vite-pwa';

function fakeWorker(state = 'installing'): WorkerLike & { fire: (s: string) => void; messages: unknown[] } {
  const listeners: Array<() => void> = [];
  const w = {
    state,
    messages: [] as unknown[],
    postMessage: (m: unknown) => w.messages.push(m),
    addEventListener: (_t: 'statechange', fn: () => void) => listeners.push(fn),
    fire: (s: string) => {
      w.state = s;
      listeners.forEach((fn) => fn());
    },
  };
  return w;
}

function fakeRegistration(): RegistrationLike & { found: () => void } {
  let onFound: () => void = () => undefined;
  const reg = {
    waiting: null as WorkerLike | null,
    installing: null as WorkerLike | null,
    addEventListener: (_t: 'updatefound', fn: () => void) => {
      onFound = fn;
    },
    found: () => onFound(),
  };
  return reg;
}

describe('PWA: aviso de versión nueva', () => {
  afterEach(() => usePwaStore.setState({ updateReady: false, applyUpdate: null }));

  it('avisa cuando se instala un service worker nuevo y la página ya estaba controlada', () => {
    const reg = fakeRegistration();
    const ready = vi.fn();
    watchForUpdates(reg, () => true, ready);
    const w = fakeWorker();
    reg.installing = w;
    reg.found();
    w.fire('installed');
    expect(ready).toHaveBeenCalledWith(w);
  });

  it('no avisa en la primera instalación (sin controlador)', () => {
    const reg = fakeRegistration();
    const ready = vi.fn();
    watchForUpdates(reg, () => false, ready);
    const w = fakeWorker();
    reg.installing = w;
    reg.found();
    w.fire('installed');
    expect(ready).not.toHaveBeenCalled();
  });

  it('avisa al arrancar si ya había uno esperando', () => {
    const reg = fakeRegistration();
    reg.waiting = fakeWorker('installed');
    const ready = vi.fn();
    watchForUpdates(reg, () => true, ready);
    expect(ready).toHaveBeenCalledWith(reg.waiting);
  });

  it('al activar pide SKIP_WAITING y recarga una sola vez al cambiar de controlador', () => {
    const w = fakeWorker('installed');
    let change: () => void = () => undefined;
    const container = { addEventListener: (_t: string, fn: () => void) => (change = fn) } as unknown as ServiceWorkerContainer;
    const reload = vi.fn();
    activateWorker(w, container, reload);
    expect(w.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    change();
    change();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('muestra «Hay una versión nueva» y recarga al pulsar el botón', async () => {
    const apply = vi.fn();
    usePwaStore.getState().setUpdate(apply);
    render(<UpdatePrompt />);
    expect(screen.getByRole('status')).toHaveTextContent('Hay una versión nueva');
    await userEvent.click(screen.getByRole('button', { name: 'Recargar' }));
    expect(apply).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Más tarde' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('el service worker precachea rutas relativas al ámbito (vale para cualquier base)', () => {
    const src = serviceWorkerSource('abc', ['index.html', 'assets/index-1.js']);
    expect(src).toContain('"assets/index-1.js"');
    expect(src).toContain('self.registration.scope');
    expect(src).not.toContain('/domoticaSimulator/');
  });
});
