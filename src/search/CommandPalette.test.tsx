import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useProjectStore } from '../store/projectStore';
import { useLayoutStore } from '../store/layoutStore';
import { useUiStore } from '../store/uiStore';
import { useExtrasStore } from '../store/extrasStore';
import { makeDevice, makeProject } from '../test/fixtures';
import { CommandPalette } from './CommandPalette';

const project = () =>
  makeProject({
    floors: [
      { id: 'f1', name: 'Planta baja', level: 0, pixelsPerMeter: 40 },
      { id: 'f2', name: 'Primera', level: 1, pixelsPerMeter: 40 },
    ],
    devices: [{ ...makeDevice('sonoff-snzb-03p', 'd1', 100, 100, 'Sensor del garaje'), floorId: 'f2' }],
    automations: [{ id: 'a1', name: 'Luces del garaje', enabled: true, mode: 'single', triggers: [], conditions: [], actions: [] }],
  });

beforeEach(() => {
  useProjectStore.getState().loadProject(project());
  useUiStore.getState().reset();
  useLayoutStore.getState().reset();
  useExtrasStore.getState().reset();
  useLayoutStore.getState().setPaletteOpen(true);
});

describe('búsqueda global (Ctrl+K)', () => {
  it('es un combobox accesible con resultados agrupados', async () => {
    render(<CommandPalette />);
    const input = screen.getByRole('combobox', { name: 'Buscar dispositivos, automatizaciones y acciones' });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
    // Sin consulta, las acciones.
    expect(screen.getByRole('group', { name: 'Acciones' })).toBeInTheDocument();
    await userEvent.type(input, 'garaje');
    const list = screen.getByRole('listbox', { name: 'Resultados de la búsqueda' });
    expect(within(list).getByRole('group', { name: 'Dispositivos' })).toHaveTextContent('Sensor del garaje');
    expect(within(list).getByRole('group', { name: 'Automatizaciones' })).toHaveTextContent('Luces del garaje');
    const first = within(list).getAllByRole('option')[0];
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', first?.id);
    await userEvent.keyboard('{ArrowDown}');
    expect(within(list).getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('al elegir un dispositivo cambia de planta, lo selecciona y lo centra', async () => {
    render(<CommandPalette />);
    await userEvent.type(screen.getByRole('combobox'), 'sensor del garaje');
    await userEvent.click(within(screen.getByRole('group', { name: 'Dispositivos' })).getByRole('option'));
    const ui = useUiStore.getState();
    expect(ui.activeFloorId).toBe('f2');
    expect(ui.selection).toEqual(['d1']);
    expect(ui.focusRequest?.deviceIds).toEqual(['d1']);
    expect(useLayoutStore.getState().paletteOpen).toBe(false);
  });

  it('al elegir una automatización la abre', async () => {
    render(<CommandPalette />);
    await userEvent.type(screen.getByRole('combobox'), 'luces');
    const group = screen.getByRole('group', { name: 'Automatizaciones' });
    await userEvent.click(within(group).getByRole('option'));
    expect(useUiStore.getState().selectedAutomationId).toBe('a1');
    expect(useUiStore.getState().bottomTab).toBe('automations');
  });

  it('ejecuta una acción con Intro y se cierra con Escape', async () => {
    render(<CommandPalette />);
    await userEvent.type(screen.getByRole('combobox'), 'ver el dashboard{Enter}');
    expect(useExtrasStore.getState().centerView).toBe('dashboard');
    expect(useLayoutStore.getState().paletteOpen).toBe(false);
  });

  it('la acción «Importar desde Home Assistant» abre el asistente', async () => {
    render(<CommandPalette />);
    await userEvent.type(screen.getByRole('combobox'), 'importar desde home{Enter}');
    expect(useLayoutStore.getState().importHaOpen).toBe(true);
  });

  it('Escape cierra la paleta', async () => {
    render(<CommandPalette />);
    await userEvent.keyboard('{Escape}');
    expect(useLayoutStore.getState().paletteOpen).toBe(false);
  });
});
