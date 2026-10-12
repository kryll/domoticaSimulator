import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupsSection } from './GroupsSection';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';

describe('GroupsSection', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    const project = makeProject({
      rooms: [{ id: 'r1', floorId: 'f1', name: 'Salón', polygon: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }] }],
      devices: [
        { ...makeDevice('hue-white-e27', 'd1', 100, 100, 'Luz 1'), roomId: 'r1' },
        { ...makeDevice('hue-white-e27', 'd2', 200, 200, 'Luz 2'), roomId: 'r1' },
        makeDevice('hue-white-e27', 'd3', 900, 900, 'Luz pasillo'),
      ],
    });
    useProjectStore.getState().loadProject(project);
    act(() => useSimulationStore.getState().reset(project));
  });

  it('crea un grupo de luces de una sala y lo controla', async () => {
    render(<GroupsSection />);
    await userEvent.click(screen.getByRole('button', { name: '+ Nuevo grupo' }));
    await userEvent.type(screen.getByLabelText('Nombre del grupo'), 'Luces salón');
    await userEvent.click(screen.getByRole('button', { name: '+ Salón' }));
    await userEvent.click(screen.getByRole('button', { name: 'Crear grupo' }));
    expect(useProjectStore.getState().project.groups).toEqual([
      expect.objectContaining({ name: 'Luces salón', domain: 'light', entityIds: ['light.luz_1', 'light.luz_2'] }),
    ]);
    // la simulación crea la entidad del grupo al sincronizarse con el proyecto
    act(() => useSimulationStore.getState().syncWithProject(useProjectStore.getState().project));
    const row = within(screen.getByRole('list', { name: 'Grupos' })).getByRole('listitem');
    await userEvent.click(within(row).getByRole('button', { name: 'Encender Luces salón' }));
    const entities = useSimulationStore.getState().sim.entities;
    expect(entities['light.luz_1']?.state).toBe('on');
    expect(entities['light.luz_2']?.state).toBe('on');
    expect(entities['light.luz_pasillo']?.state).toBe('off');
  });

  it('parte de la selección del lienzo', async () => {
    useUiStore.getState().select({ kind: 'device', id: 'd3' });
    render(<GroupsSection />);
    await userEvent.click(screen.getByRole('button', { name: '+ Nuevo grupo' }));
    expect(screen.getByRole('checkbox', { name: /Luz pasillo/ })).toBeChecked();
  });
});

describe('renombrar un grupo', () => {
  it('actualiza las automatizaciones y conserva el estado en la simulación', async () => {
    const project = makeProject({
      devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz')],
      groups: [{ id: 'g', name: 'Luces', domain: 'light', entityIds: ['light.luz'] }],
      automations: [
        { id: 'a1', name: 'x', enabled: true, mode: 'single', triggers: [], conditions: [], actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.grupo_luces' }] },
      ],
    });
    useProjectStore.getState().loadProject(project);
    act(() => useSimulationStore.getState().reset(project));
    act(() => useSimulationStore.getState().callService('light.luz', 'light.turn_on'));
    render(<GroupsSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Editar Luces' }));
    const name = screen.getByLabelText('Nombre del grupo');
    await userEvent.clear(name);
    await userEvent.type(name, 'Salón');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar grupo' }));
    const p = useProjectStore.getState().project;
    expect(p.automations[0]?.actions[0]).toMatchObject({ entityId: 'light.grupo_salon' });
    expect(useSimulationStore.getState().sim.entities['light.grupo_salon']?.state).toBe('on');
    act(() => useProjectStore.getState().undo());
    expect(useProjectStore.getState().project.groups?.[0]?.name).toBe('Luces');
  });
});
