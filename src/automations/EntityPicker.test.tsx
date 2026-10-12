import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityPicker } from './EntityPicker';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { makeDevice, makeProject } from '../test/fixtures';

describe('EntityPicker', () => {
  beforeEach(() => {
    const p = makeProject({
      rooms: [{ id: 'r1', floorId: 'f1', name: 'Salón', polygon: [] }],
      devices: [
        { ...makeDevice('netatmo-thermostat', 't1', 0, 0, 'Termostato'), roomId: 'r1' },
        makeDevice('aqara-temp-hum', 'c1', 0, 0, 'Clima'),
        makeDevice('hue-white-e27', 'l1', 0, 0, 'Luz'),
        makeDevice('aqara-motion-p1', 'm1', 0, 0, 'Pasillo'),
      ],
    });
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
  });

  const options = () =>
    within(screen.getByRole('listbox', { name: 'Opciones: Entidad' }))
      .queryAllByRole('option')
      .map((o) => o.getAttribute('title'));

  it('muestra «Dispositivo · Entidad» sin repetir el nombre y agrupa por sala', async () => {
    render(<EntityPicker label="Entidad" value="" onChange={() => {}} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Entidad' }));
    const listbox = screen.getByRole('listbox', { name: 'Opciones: Entidad' });
    const labels = within(listbox)
      .getAllByRole('option')
      .map((o) => o.textContent ?? '');
    expect(labels.some((l) => l.includes('Clima · Temperatura'))).toBe(true);
    expect(labels.some((l) => /Termostato Termostato|Termostato · Termostato/.test(l))).toBe(false);
    expect(within(listbox).getByRole('group', { name: 'Salón' })).toBeInTheDocument();
    expect(within(listbox).getByRole('group', { name: 'Sin sala' })).toBeInTheDocument();
    // el estado actual se muestra junto al nombre
    expect(labels.find((l) => l.includes('Luz'))).toMatch(/off/);
  });

  it('filtra al escribir y elige con el teclado', async () => {
    let chosen = '';
    render(<EntityPicker label="Entidad" value="" onChange={(id) => (chosen = id)} />);
    const input = screen.getByRole('combobox', { name: 'Entidad' });
    await userEvent.click(input);
    const total = options().length;
    await userEvent.type(input, 'clima hum');
    expect(options()).toEqual(['sensor.clima_humidity']);
    expect(options().length).toBeLessThan(total);
    await userEvent.keyboard('{Enter}');
    expect(chosen).toBe('sensor.clima_humidity');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('filtra por dominio y por device_class', async () => {
    render(<EntityPicker label="Entidad" value="" onChange={() => {}} domains={['binary_sensor']} deviceClasses={['motion']} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Entidad' }));
    expect(options()).toEqual(['binary_sensor.pasillo_motion']);
  });

  it('muestra un aviso si la entidad no existe', () => {
    render(<EntityPicker label="Entidad" value="light.fantasma" onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Entidad' })).toHaveValue('light.fantasma (no existe)');
  });
});
