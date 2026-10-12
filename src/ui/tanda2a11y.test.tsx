import '../test/flowMocks';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { TopBar } from './TopBar';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useViewStore } from '../store/viewStore';
import { useExtrasStore } from '../store/extrasStore';
import { stopSimulationLoop, useSimulationStore } from '../store/simulationStore';
import { saveProject } from '../store/persistence';
import { ProjectsDialog } from './ProjectsDialog';
import { makeDevice, makeProject } from '../test/fixtures';
import { PROTOCOL_INK } from '../canvas/style';

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
}

/** Contraste WCAG entre dos colores #rrggbb. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe('accesibilidad de la Tanda 2', () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(makeProject({ devices: [makeDevice('hue-white-e27', 'l1')] }));
    useUiStore.getState().reset();
    useViewStore.getState().reset();
    useExtrasStore.getState().reset();
  });
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
    stopSimulationLoop();
  });

  it('los menús de la barra superior son role=menu con flechas, Inicio/Fin y Escape', async () => {
    mockMatchMedia(true);
    render(<TopBar />);
    const button = screen.getByRole('button', { name: /Archivo/ });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu', { name: 'Archivo' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(items[items.length - 1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('Archivo incluye «Modo presentación» y Exportar «Propuesta (PDF)…»', async () => {
    mockMatchMedia(true);
    render(<TopBar />);
    await userEvent.click(screen.getByRole('button', { name: /Exportar/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Propuesta (PDF)…' }));
    expect(useViewStore.getState().proposalOpen).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /Archivo/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Modo presentación' }));
    expect(useViewStore.getState().presentation).toBe(true);
    useViewStore.getState().setPresentation(false);
  });

  it('enlaces de salto al lienzo y a las propiedades', async () => {
    useSimulationStore.getState().reset(useProjectStore.getState().project);
    render(<App autoLoad={false} />);
    await act(async () => {});
    const nav = screen.getByRole('navigation', { name: 'Enlaces de salto' });
    await userEvent.click(within(nav).getByRole('link', { name: 'Saltar al lienzo' }));
    expect(screen.getByRole('region', { name: 'Lienzo del plano' })).toHaveFocus();
    await userEvent.click(within(nav).getByRole('link', { name: 'Saltar a propiedades' }));
    expect(document.getElementById('panel-propiedades')).toHaveFocus();
  });

  it('las salas no llevan aria-label en un div sin rol (aria-prohibited-attr)', async () => {
    useProjectStore.getState().loadProject(
      makeProject({ rooms: [{ id: 'r1', floorId: 'f1', name: 'Salón', polygon: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }] }] }),
    );
    render(<App autoLoad={false} />);
    await act(async () => {});
    const room = screen.getByTestId('room-node-r1');
    expect(room).not.toHaveAttribute('aria-label');
    for (const el of document.querySelectorAll('div[aria-label]')) {
      expect(el.getAttribute('role'), `div con aria-label sin rol: ${el.getAttribute('aria-label')}`).not.toBeNull();
    }
  });

  it('las tintas de protocolo tienen contraste AA con blanco', () => {
    for (const [protocol, ink] of Object.entries(PROTOCOL_INK)) {
      expect(contrast(ink, '#ffffff'), protocol).toBeGreaterThanOrEqual(4.5);
    }
    // Botón primario (sky-700) con texto blanco.
    expect(contrast('#0369a1', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('«Abrir…» lista el proyecto abierto aunque aún no esté guardado', async () => {
    useProjectStore.getState().loadProject(makeProject({ id: 'demo-sin-guardar', name: 'Casa de demo' }));
    render(<ProjectsDialog onClose={() => undefined} />);
    expect(await screen.findByText(/Casa de demo/)).toBeInTheDocument();
    expect(screen.queryByText('No hay proyectos guardados.')).toBeNull();
  });

  it('«Abrir…» lista los proyectos guardados', async () => {
    await saveProject(makeProject({ id: 'guardado-1', name: 'Guardado uno' }));
    render(<ProjectsDialog onClose={() => undefined} />);
    expect(await screen.findByText(/Guardado uno/)).toBeInTheDocument();
  });
});
