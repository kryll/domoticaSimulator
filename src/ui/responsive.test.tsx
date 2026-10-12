import '../test/flowMocks';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useLayoutStore } from '../store/layoutStore';
import { makeDevice, makeProject } from '../test/fixtures';
import { createLongPress } from '../canvas/longPress';
import { Drawer } from './Drawer';
import { ShortcutsHelp } from './ShortcutsHelp';

/** Simula el ancho de la ventana: las media queries min-width se cumplen si el ancho llega. */
function setWidth(px: number) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => {
      const m = /min-width:\s*(\d+)px/.exec(query);
      return { matches: m ? px >= Number(m[1]) : false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
    },
  });
}

async function renderApp() {
  render(<App autoLoad={false} />);
  await act(async () => {});
}

const DEF = 'sonoff-snzb-03p';

describe('diseño responsive', () => {
  beforeEach(() => {
    useLayoutStore.getState().reset();
  });
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('a 390 px: cabecera compacta, panel inferior plegado y catálogo y propiedades en cajones', async () => {
    setWidth(390);
    useUiStore.getState().reset();
    useProjectStore.getState().loadProject(makeProject({ devices: [makeDevice(DEF, 'd1')] }));
    await renderApp();
    const header = screen.getByRole('heading', { name: 'HA Simulator' }).closest('header') as HTMLElement;
    expect(header).toHaveAttribute('data-compact', 'true');
    expect(within(header).getByRole('button', { name: 'Ajustes' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: 'Buscar' })).toBeInTheDocument();
    expect(useUiStore.getState().bottomOpen).toBe(false);
    // Sin paneles laterales fijos.
    expect(screen.queryByRole('complementary', { name: 'Catálogo de dispositivos' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Catálogo' }));
    const drawer = screen.getByRole('dialog', { name: 'Catálogo' });
    expect(within(drawer).getByRole('complementary', { name: 'Catálogo de dispositivos' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Catálogo' })).toBeNull();
    act(() => useUiStore.getState().select({ kind: 'device', id: 'd1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Propiedades (hay selección)' }));
    const sheet = screen.getByRole('dialog', { name: 'Propiedades' });
    expect(within(sheet).getByLabelText('Nombre')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cerrar propiedades' }));
    expect(screen.queryByRole('dialog', { name: 'Propiedades' })).toBeNull();
  });

  it('en el móvil el panel inferior abierto ocupa toda la pantalla', async () => {
    setWidth(390);
    useUiStore.getState().reset();
    useProjectStore.getState().loadProject(makeProject());
    await renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Desplegar panel inferior' }));
    expect(screen.getByRole('region', { name: 'Panel inferior' }).className).toContain('fixed inset-0');
    // No hay botón de maximizar: ya está a pantalla completa.
    expect(screen.queryByRole('button', { name: 'Maximizar panel inferior' })).toBeNull();
  });

  it('a 1280 px los paneles laterales siguen fijos y la cabecera completa', async () => {
    setWidth(1280);
    useUiStore.getState().reset();
    useProjectStore.getState().loadProject(makeProject());
    await renderApp();
    expect(screen.getByRole('complementary', { name: 'Catálogo de dispositivos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'HA Simulator' }).closest('header')).not.toHaveAttribute('data-compact');
    expect(screen.queryByRole('button', { name: 'Catálogo' })).toBeNull();
  });

  it('Ctrl+K abre la búsqueda global incluso desde un campo de texto', async () => {
    setWidth(1280);
    useUiStore.getState().reset();
    useProjectStore.getState().loadProject(makeProject());
    await renderApp();
    screen.getByLabelText('Buscar dispositivo').focus();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(useLayoutStore.getState().paletteOpen).toBe(true);
  });
});

describe('cajón', () => {
  it('es un diálogo modal que atrapa el foco y lo devuelve al cerrar', async () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(
      <Drawer open title="Catálogo" onClose={onClose}>
        <button type="button">Dentro</button>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Catálogo' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    rerender(
      <Drawer open={false} title="Catálogo" onClose={onClose}>
        <button type="button">Dentro</button>
      </Drawer>,
    );
    expect(opener).toHaveFocus();
    opener.remove();
  });
});

describe('pulsación larga', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const touch = (x: number, y: number) => ({ pointerType: 'touch', pointerId: 1, clientX: x, clientY: y, target: null, isPrimary: true });

  it('con el dedo quieto abre el menú y descarta el clic siguiente', () => {
    const onLongPress = vi.fn();
    const lp = createLongPress({ onLongPress });
    lp.down(touch(10, 10));
    vi.advanceTimersByTime(600);
    expect(onLongPress).toHaveBeenCalledWith({ x: 10, y: 10, target: null });
    expect(lp.consumeFired()).toBe(true);
    expect(lp.consumeFired()).toBe(false);
  });

  it('se cancela al mover el dedo, al soltar antes de tiempo o con el ratón', () => {
    const onLongPress = vi.fn();
    const lp = createLongPress({ onLongPress });
    lp.down(touch(10, 10));
    lp.move(touch(30, 10));
    vi.advanceTimersByTime(600);
    lp.down(touch(10, 10));
    vi.advanceTimersByTime(200);
    lp.up();
    vi.advanceTimersByTime(600);
    lp.down({ ...touch(0, 0), pointerType: 'mouse' });
    vi.advanceTimersByTime(600);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});

describe('ayuda de atajos', () => {
  it('incluye Ctrl+K y la pulsación larga', () => {
    useUiStore.getState().setShortcutsOpen(true);
    render(<ShortcutsHelp />);
    expect(screen.getByText('Ctrl/Cmd+K')).toBeInTheDocument();
    expect(screen.getByText('Pulsación larga')).toBeInTheDocument();
    useUiStore.getState().setShortcutsOpen(false);
  });
});
