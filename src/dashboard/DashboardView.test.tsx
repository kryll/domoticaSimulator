import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardView } from './DashboardView';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { makeDevice, makeProject } from '../test/fixtures';

describe('DashboardView', () => {
  beforeEach(() => {
    const project = makeProject({
      rooms: [{ id: 'r1', floorId: 'f1', name: 'Salón', polygon: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }] }],
      devices: [{ ...makeDevice('hue-white-e27', 'd1', 100, 100, 'Luz salón'), roomId: 'r1' }, { ...makeDevice('aqara-motion-p1', 'd2', 150, 150, 'Sensor'), roomId: 'r1' }],
      groups: [{ id: 'g1', name: 'Luces', domain: 'light', entityIds: ['light.luz_salon'] }],
    });
    useProjectStore.getState().loadProject(project);
    act(() => useSimulationStore.getState().reset(project));
  });

  it('pinta las tarjetas por sala y la tile alterna la luz', async () => {
    render(<DashboardView />);
    const region = screen.getByRole('region', { name: 'Vista Planta baja' });
    expect(within(region).getByRole('heading', { name: 'Salón' })).toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'Encender Luz salón' }));
    expect(useSimulationStore.getState().sim.entities['light.luz_salon']?.state).toBe('on');
    expect(within(region).getByRole('button', { name: 'Apagar Luz salón' })).toBeInTheDocument();
    // la tarjeta del grupo refleja el estado de sus miembros
    expect(screen.getByTestId('tile-state-light.grupo_luces')).toHaveTextContent('on');
  });

  it('abre «más información» con los controles existentes', async () => {
    render(<DashboardView />);
    await userEvent.click(screen.getByTitle('Más información', { exact: false }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('exporta el YAML de Lovelace', async () => {
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<DashboardView />);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar YAML Lovelace' }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});
