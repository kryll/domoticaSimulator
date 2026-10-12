import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScenesPanel } from './ScenesPanel';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { makeDevice, makeProject } from '../test/fixtures';
import { pickEntity } from '../test/pickEntity';

describe('ScenesPanel', () => {
  beforeEach(() => {
    const p = makeProject({
      devices: [makeDevice('hue-white-color-e27', 'luz', 0, 0, 'Luz salón'), makeDevice('shelly-2pm-gen3-cover', 'per', 0, 0, 'Persiana')],
      scenes: [{ id: 's1', name: 'Cine', entities: { 'light.luz_salon': { state: 'on', attributes: { brightness: 255 } } } }],
    });
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
  });

  const scene = () => useProjectStore.getState().project.scenes[0];

  it('crea una escena capturando solo los atributos relevantes', async () => {
    useSimulationStore.getState().callService('light.luz_salon', 'turn_on', { brightness_pct: 50 });
    render(<ScenesPanel />);
    await userEvent.click(screen.getByRole('button', { name: '+ Nueva escena' }));
    const dialog = screen.getByRole('dialog', { name: 'Nueva escena' });
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Luz salón/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Capturar estado y crear' }));
    const created = useProjectStore.getState().project.scenes[1];
    expect(created?.entities['light.luz_salon']?.state).toBe('on');
    expect(created?.entities['light.luz_salon']?.attributes?.brightness).toBe(128);
    expect(created?.entities['light.luz_salon']?.attributes).not.toHaveProperty('friendly_name');
  });

  it('permite editar el objetivo, añadir y quitar entidades', async () => {
    render(<ScenesPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Editar escena Cine' }));
    const list = screen.getByRole('list', { name: 'Entidades de Cine' });
    fireEvent.change(within(list).getByRole('slider', { name: 'Brillo' }), { target: { value: '30' } });
    expect(scene()?.entities['light.luz_salon']?.attributes?.brightness).toBe(77);
    // la simulación no cambia: solo el objetivo de la escena
    expect(useSimulationStore.getState().sim.entities['light.luz_salon']?.state).toBe('off');

    await pickEntity('Añadir entidad', 'cover.persiana_cover');
    await userEvent.click(screen.getByRole('button', { name: 'Añadir' }));
    expect(scene()?.entities['cover.persiana_cover']?.state).toBe('closed');
    fireEvent.change(within(list).getByRole('slider', { name: 'Posición' }), { target: { value: '60' } });
    expect(scene()?.entities['cover.persiana_cover']).toMatchObject({ state: 'open', attributes: { current_position: 60 } });

    await userEvent.click(screen.getByRole('button', { name: 'Quitar Luz salón de la escena' }));
    expect(scene()?.entities).not.toHaveProperty('light.luz_salon');
  });
});
