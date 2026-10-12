import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateGallery } from './TemplateGallery';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';
import { pickEntity } from '../test/pickEntity';

describe('TemplateGallery', () => {
  beforeEach(() => {
    const p = makeProject({
      rooms: [{ id: 'r1', floorId: 'f1', name: 'Pasillo', polygon: [] }],
      devices: [
        { ...makeDevice('aqara-motion-p1', 'm1', 0, 0, 'Sensor pasillo'), roomId: 'r1' },
        { ...makeDevice('hue-white-e27', 'l1', 0, 0, 'Luz pasillo'), roomId: 'r1' },
        makeDevice('hue-white-e27', 'l2', 0, 0, 'Luz salón'),
      ],
    });
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
    useUiStore.getState().reset();
  });

  it('muestra primero las sugeridas y crea la automatización desde el formulario', async () => {
    useUiStore.getState().openTemplates({});
    render(<TemplateGallery />);
    const dialog = screen.getByRole('dialog', { name: 'Crear desde plantilla' });
    const suggested = within(dialog).getByRole('region', { name: 'Sugeridas para tu proyecto' });
    await userEvent.click(within(suggested).getByRole('button', { name: /Luz con movimiento/ }));

    const form = screen.getByRole('form', { name: 'Plantilla Luz con movimiento' });
    // la sugerencia propone el sensor y la luz de la misma sala; se cambia la luz
    expect(within(form).getByRole('combobox', { name: 'Sensor de movimiento' })).toHaveValue('Sensor pasillo · Movimiento');
    await pickEntity('Luz', 'light.luz_salon');
    await userEvent.click(within(form).getByRole('button', { name: 'Crear automatización' }));

    const automations = useProjectStore.getState().project.automations;
    expect(automations).toHaveLength(1);
    expect(automations[0]).toMatchObject({
      triggers: [{ type: 'state', entityId: 'binary_sensor.sensor_pasillo_motion', to: 'on' }],
      mode: 'restart',
    });
    expect(automations[0]?.actions[0]).toMatchObject({ entityId: 'light.luz_salon' });
    expect(useUiStore.getState().selectedAutomationId).toBe(automations[0]?.id);
    expect(useUiStore.getState().templateGallery).toBeNull();
  });

  it('desde el menú del nodo ofrece las plantillas con ese dispositivo', () => {
    useUiStore.getState().openTemplates({ deviceId: 'm1' });
    render(<TemplateGallery />);
    const dialog = screen.getByRole('dialog', { name: 'Plantillas con Sensor pasillo' });
    expect(within(dialog).getByRole('button', { name: /Luz con movimiento/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('region', { name: 'Otras plantillas' })).toBeNull();
  });

  it('las plantillas no aplicables aparecen desactivadas con su motivo', () => {
    useUiStore.getState().openTemplates({});
    render(<TemplateGallery />);
    const others = screen.getByRole('region', { name: 'Otras plantillas' });
    const leak = within(others).getByRole('button', { name: /fuga/i });
    expect(leak).toBeDisabled();
    expect(leak).toHaveAccessibleDescription(/Falta en el proyecto/);
  });

  it('desde un dispositivo, no deja crear una plantilla a la que le faltan entidades', () => {
    const p = makeProject({ devices: [makeDevice('aqara-motion-p1', 'm1', 0, 0, 'Sensor solo')] });
    useProjectStore.getState().loadProject(p);
    useUiStore.getState().openTemplates({ deviceId: 'm1' });
    render(<TemplateGallery />);
    const card = screen.getByRole('button', { name: /Luz con movimiento/ });
    expect(card).toBeDisabled();
    expect(card).toHaveAccessibleDescription(/Falta en el proyecto: «Luz»/);
  });
});
