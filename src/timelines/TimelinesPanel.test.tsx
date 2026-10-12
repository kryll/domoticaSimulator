import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimelinesPanel } from './TimelinesPanel';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { makeDevice, makeProject } from '../test/fixtures';

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
    await userEvent.selectOptions(within(steps).getByLabelText('Entidad'), 'light.luz_salon');
    await userEvent.click(screen.getByRole('button', { name: '+ Comprobación' }));
    const pickers = within(steps).getAllByLabelText('Entidad');
    await userEvent.selectOptions(pickers[1] as HTMLElement, 'light.luz_salon');
    const times = within(steps).getAllByLabelText('Hora');
    fireEvent.change(times[1] as HTMLElement, { target: { value: '08:00:05' } });

    await userEvent.click(screen.getByRole('button', { name: '▶ Ejecutar' }));
    expect(screen.getByRole('status')).toHaveTextContent('✓ Superada');
    const results = screen.getByRole('list', { name: 'Resultados de la prueba' });
    expect(within(results).getAllByRole('listitem')).toHaveLength(2);

    // si se espera otro estado, la prueba falla
    fireEvent.change(within(steps).getByLabelText('Valor esperado'), { target: { value: 'off' } });
    await userEvent.click(screen.getByRole('button', { name: '▶ Ejecutar' }));
    expect(screen.getByRole('status')).toHaveTextContent('✗ 1 fallo');
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
