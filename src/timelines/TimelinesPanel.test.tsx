import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimelinesPanel } from './TimelinesPanel';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { makeDevice, makeProject } from '../test/fixtures';
import { pickEntity } from '../test/pickEntity';

describe('TimelinesPanel', () => {
  beforeEach(() => {
    const project = makeProject({ devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz salón')] });
    useProjectStore.getState().loadProject(project);
    act(() => useSimulationStore.getState().reset(project));
  });

  it('crea una prueba con un evento y una comprobación y la ejecuta', async () => {
    render(<TimelinesPanel />);
    await userEvent.click(screen.getByRole('button', { name: '+ Nueva prueba' }));
    await userEvent.click(screen.getByRole('button', { name: '+ Evento' }));
    const steps = screen.getByRole('group', { name: 'Pasos' });
    await pickEntity('Entidad', 'light.luz_salon');
    await userEvent.click(screen.getByRole('button', { name: '+ Comprobación' }));
    await pickEntity('Entidad', 'light.luz_salon', 1);
    const times = within(steps).getAllByLabelText('Hora');
    fireEvent.change(times[1] as HTMLElement, { target: { value: '08:00:05' } });

    await userEvent.click(screen.getByRole('button', { name: '▶ Ejecutar' }));
    expect(screen.getByText(/✓ Superada/)).toHaveAttribute('role', 'status');
    const results = screen.getByRole('list', { name: 'Resultados de la prueba' });
    expect(within(results).getAllByRole('listitem')).toHaveLength(2);

    // si se espera otro estado, la prueba falla
    fireEvent.change(within(steps).getByLabelText('Valor esperado'), { target: { value: 'off' } });
    await userEvent.click(screen.getByRole('button', { name: '▶ Ejecutar' }));
    expect(screen.getByText(/✗ 1 fallo/)).toHaveAttribute('role', 'status');
  });

  it('graba los pasos desde el registro', async () => {
    act(() => useSimulationStore.getState().callService('light.luz_salon', 'light.turn_on'));
    render(<TimelinesPanel />);
    await userEvent.click(screen.getByRole('button', { name: '+ Nueva prueba' }));
    await userEvent.click(screen.getByRole('button', { name: '⏺ Grabar desde el registro' }));
    const steps = useProjectStore.getState().project.timelines?.[0]?.steps ?? [];
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[0]).toMatchObject({ kind: 'event', entityId: 'light.luz_salon' });
  });
});

describe('inicio de la prueba', () => {
  it('se edita en el editor y la ejecución empieza en esa fecha', async () => {
    const project = makeProject({
      devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz salón')],
      timelines: [{ id: 't1', name: 'Mañana', steps: [{ at: '08:00', kind: 'assert', entityId: 'light.luz_salon', expect: 'off' }] }],
    });
    useProjectStore.getState().loadProject(project);
    act(() => useSimulationStore.getState().reset(project));
    render(<TimelinesPanel />);
    fireEvent.change(screen.getByLabelText('Inicio de la prueba'), { target: { value: '2027-03-05T00:00' } });
    expect(useProjectStore.getState().project.timelines?.[0]?.startAt).toBe(Date.UTC(2027, 2, 5));
    expect(screen.getByText(/Empieza el 05\/03\/2027 a las 00:00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '▶ Ejecutar' }));
    expect(await screen.findByText(/✓ Superada/)).toBeInTheDocument();
  });
});
