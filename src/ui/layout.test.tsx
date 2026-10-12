import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopBar } from './TopBar';
import { OverflowTabs } from './OverflowTabs';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useExtrasStore } from '../store/extrasStore';
import { makeProject } from '../test/fixtures';

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({ matches, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }),
  });
}

describe('barra superior compacta', () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(makeProject());
    useUiStore.getState().reset();
    useExtrasStore.getState().reset();
  });
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('por debajo de 1440 px agrupa Archivo, Exportar y Escenarios en «☰ Proyecto»', async () => {
    mockMatchMedia(false);
    render(<TopBar />);
    expect(screen.queryByText('Archivo ▾')).toBeNull();
    await userEvent.click(screen.getByLabelText('Proyecto'));
    expect(screen.getByRole('menuitem', { name: 'Compartir enlace…' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Configuración HA (packages .zip)…' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: /Escenarios de fallo…/ }));
    expect(await screen.findByRole('dialog', { name: 'Escenarios de fallo' })).toBeInTheDocument();
  });

  it('a partir de 1440 px muestra los menús y un único «⚙ Ajustes»', async () => {
    mockMatchMedia(true);
    render(<TopBar />);
    expect(screen.getByText(/Archivo/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Ajustes/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /Archivo/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Compartir enlace…' }));
    expect(useExtrasStore.getState().dialog).toBe('share');
  });
});

describe('OverflowTabs', () => {
  it('lleva al menú «Más» las pestañas que no caben y mantiene visible la activa', async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    const onChange = vi.fn();
    const tabs = ['Uno', 'Dos', 'Tres', 'Cuatro'].map((t) => ({ key: t.toLowerCase(), label: t, text: t }));
    render(<OverflowTabs label="Prueba" tabs={tabs} active="cuatro" onChange={onChange} />);
    const list = screen.getByRole('tablist', { name: 'Prueba' });
    // caben 2 (300 - 72 del botón «Más»): la primera y la activa
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Uno', 'Cuatro']);
    await userEvent.click(screen.getByRole('button', { name: 'Más pestañas' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Tres' }));
    expect(onChange).toHaveBeenCalledWith('tres');
    width.mockRestore();
    client.mockRestore();
  });
});
