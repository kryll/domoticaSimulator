import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutomationEditor } from './AutomationEditor';
import { useProjectStore } from '../store/projectStore';
import { makeDevice, makeProject } from '../test/fixtures';
import type { Automation } from '../types';

const base: Automation = {
  id: 'a1',
  name: 'Luz por movimiento',
  enabled: true,
  triggers: [],
  conditions: [],
  actions: [],
  mode: 'single',
};

let latest: Automation = base;

function Harness() {
  const [a, setA] = useState(base);
  latest = a;
  return (
    <AutomationEditor
      automation={a}
      onChange={(next) => {
        latest = next;
        setA(next);
      }}
    />
  );
}

describe('AutomationEditor', () => {
  beforeEach(() => {
    latest = base;
    useProjectStore.getState().loadProject(
      makeProject({
        devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz salón'), makeDevice('aqara-motion-p1', 'd2', 0, 0, 'Sensor')],
      }),
    );
  });

  it('añade un disparador de estado y elige la entidad', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: '+ Cambio de estado' }));
    expect(latest.triggers).toHaveLength(1);
    await userEvent.selectOptions(screen.getByLabelText('Entidad'), 'binary_sensor.sensor_motion');
    expect(latest.triggers[0]).toMatchObject({ type: 'state', entityId: 'binary_sensor.sensor_motion', to: 'on' });
  });

  it('añade una acción de servicio y propone el servicio del dominio', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: '+ Llamar a servicio' }));
    await userEvent.selectOptions(screen.getByLabelText('Entidad'), 'light.luz_salon');
    expect(latest.actions[0]).toMatchObject({ type: 'service', entityId: 'light.luz_salon', service: 'light.turn_on' });
  });

  it('muestra el YAML sincronizado y permite editarlo', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'YAML' }));
    const textarea = screen.getByLabelText('YAML de la automatización');
    expect((textarea as HTMLTextAreaElement).value).toContain('Luz por movimiento');
    fireEvent.change(textarea, {
      target: {
        value: 'alias: Nueva\nmode: single\ntriggers:\n  - trigger: time\n    at: "07:30:00"\nactions:\n  - delay:\n      seconds: 5\n',
      },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar YAML' }));
    expect(latest.name).toBe('Nueva');
    expect(latest.id).toBe('a1');
    expect(latest.triggers[0]).toMatchObject({ type: 'time' });
  });

  it('muestra los errores de parseo del YAML', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('tab', { name: 'YAML' }));
    const textarea = screen.getByLabelText('YAML de la automatización');
    fireEvent.change(textarea, { target: { value: 'esto: [no es valido' } });
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar YAML' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Error en el YAML');
    expect(latest.name).toBe('Luz por movimiento');
  });
});
