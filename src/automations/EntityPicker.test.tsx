import { render, screen, within } from '@testing-library/react';
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
      ],
    });
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
  });

  it('muestra «Dispositivo · Entidad» sin repetir el nombre y agrupa por sala', () => {
    render(<EntityPicker label="Entidad" value="" onChange={() => {}} />);
    const select = screen.getByLabelText('Entidad');
    const labels = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent ?? '');
    expect(labels).toContain('Clima · Temperatura');
    expect(labels).toContain('Luz');
    expect(labels.some((l) => /Termostato Termostato|Termostato · Termostato/.test(l))).toBe(false);
    expect(labels).toContain('Termostato');
    expect(select.querySelector('optgroup[label="Salón"]')).not.toBeNull();
    expect(select.querySelector('optgroup[label="Sin sala"]')).not.toBeNull();
  });
});
