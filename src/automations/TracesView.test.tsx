import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutomationsPanel } from './AutomationsPanel';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';

describe('Trazas de automatizaciones', () => {
  beforeEach(() => {
    const p = makeProject({
      devices: [makeDevice('aqara-motion-p1', 'm1', 0, 0, 'Sensor'), makeDevice('hue-white-e27', 'l1', 0, 0, 'Luz')],
      automations: [
        {
          id: 'a1',
          name: 'Luz por movimiento',
          enabled: true,
          mode: 'single',
          triggers: [{ type: 'state', entityId: 'binary_sensor.sensor_motion', to: 'on' }],
          conditions: [{ type: 'state', entityId: 'light.luz', state: 'on' }],
          actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz' }],
        },
      ],
    });
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
    useUiStore.getState().reset();
    useUiStore.getState().showAutomation('a1', 'traces');
  });

  it('«Probar disparador» deja una traza con la condición fallida y resalta los dispositivos', async () => {
    render(<AutomationsPanel />);
    expect(screen.getByText('Aún no hay ejecuciones de esta automatización.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Probar disparador 1/ }));

    const detail = screen.getByLabelText('Detalle de la traza');
    expect(detail).toHaveTextContent('Condiciones no cumplidas');
    const conditions = within(detail).getByRole('list', { name: 'Condiciones evaluadas' });
    expect(within(conditions).getByRole('img', { name: 'No se cumple' })).toBeInTheDocument();
    expect(useSimulationStore.getState().sim.entities['light.luz']?.state).toBe('off');
    expect(useUiStore.getState().highlightedDeviceIds.sort()).toEqual(['l1', 'm1']);

    // la lista muestra el estado de la última ejecución
    expect(screen.getByRole('list', { name: 'Automatizaciones' })).toHaveTextContent(/Última ejecución: Condiciones no cumplidas/);

    // «Ejecutar acciones» se salta las condiciones
    await userEvent.click(screen.getByRole('button', { name: /Ejecutar acciones/ }));
    expect(useSimulationStore.getState().sim.entities['light.luz']?.state).toBe('on');
    expect(within(screen.getByRole('list', { name: 'Ejecuciones' })).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByLabelText('Detalle de la traza')).toHaveTextContent('Ejecutada');
  });

  it('pinta las condiciones anidadas en árbol', async () => {
    const p = useProjectStore.getState().project;
    useProjectStore.getState().loadProject({
      ...p,
      automations: [
        {
          ...p.automations[0]!,
          conditions: [{ type: 'or', conditions: [{ type: 'state', entityId: 'light.luz', state: 'on' }, { type: 'time', after: '23:59', before: '00:00' }] }],
        },
      ],
    });
    render(<AutomationsPanel />);
    await userEvent.click(screen.getByRole('button', { name: /Probar disparador 1/ }));
    const top = screen.getByRole('list', { name: 'Condiciones evaluadas' });
    const nested = within(top).getByRole('list', { name: /^Dentro de:/ });
    expect(within(nested).getAllByRole('listitem')).toHaveLength(2);
    expect(within(nested).getAllByRole('img', { name: 'No se cumple' }).length).toBeGreaterThan(0);
  });
});

describe('Trazas de wait_for_trigger', () => {
  it('muestra «Esperando hasta las 22:00 o al atardecer»', async () => {
    const p = makeProject({
      devices: [makeDevice('hue-white-e27', 'l1', 0, 0, 'Luz')],
      automations: [
        {
          id: 'a1',
          name: 'Espera',
          enabled: true,
          mode: 'single',
          triggers: [{ type: 'time', at: '07:00' }],
          conditions: [],
          actions: [
            { type: 'wait_for_trigger', triggers: [{ type: 'time', at: '22:00' }, { type: 'sun', event: 'sunset' }] },
            { type: 'service', service: 'light.turn_on', entityId: 'light.luz' },
          ],
        },
      ],
    });
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
    // 10:00: faltan la hora y el atardecer
    useSimulationStore.setState((s) => ({ sim: { ...s.sim, now: Date.UTC(2026, 9, 12, 10, 0, 0) } }));
    useUiStore.getState().reset();
    useUiStore.getState().showAutomation('a1', 'traces');
    render(<AutomationsPanel />);
    await userEvent.click(screen.getByRole('button', { name: /Ejecutar acciones/ }));
    expect(screen.getByLabelText('Detalle de la traza')).toHaveTextContent('Esperando hasta las 22:00 o al atardecer');
  });
});
