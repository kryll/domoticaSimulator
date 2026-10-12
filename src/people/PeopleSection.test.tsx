import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeopleSection } from './PeopleSection';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { makeProject } from '../test/fixtures';
import { personZoneId } from '../simulation/logic';

describe('PeopleSection', () => {
  beforeEach(() => {
    const project = makeProject({ zones: [{ id: 'trabajo', name: 'Trabajo', kind: 'work' }] });
    useProjectStore.getState().loadProject(project);
    useSimulationStore.getState().reset(project);
  });

  it('crea una persona, sale de casa y vuelve', async () => {
    render(<PeopleSection />);
    await userEvent.type(screen.getByLabelText('Nueva persona'), 'Ana');
    await userEvent.click(screen.getByRole('button', { name: '+ Añadir persona' }));
    const people = useProjectStore.getState().project.people ?? [];
    expect(people.map((p) => p.name)).toEqual(['Ana']);
    // la simulación se sincroniza con el proyecto en la app; aquí se reinicia a mano
    act(() => useSimulationStore.getState().reset(useProjectStore.getState().project));
    const id = people[0]?.id ?? '';
    const row = screen.getByRole('list', { name: 'Personas' });
    expect(await within(row).findByText('🏠 En casa')).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Salir (Ana)' }));
    expect(personZoneId(useSimulationStore.getState().sim, id)).toBeUndefined();
    expect(within(row).getByText('🚶 Fuera')).toBeInTheDocument();
    await userEvent.selectOptions(within(row).getByLabelText('Zona de Ana'), 'trabajo');
    expect(personZoneId(useSimulationStore.getState().sim, id)).toBe('trabajo');
    await userEvent.click(within(row).getByRole('button', { name: 'Llegar a casa (Ana)' }));
    expect(personZoneId(useSimulationStore.getState().sim, id)).toBe('home');
  });
});
