import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityControls } from './EntityControls';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { makeDevice, makeProject } from '../test/fixtures';
import type { EntityDefinition } from '../types';

function Connected({ entityId, definition }: { entityId: string; definition: EntityDefinition }) {
  const state = useSimulationStore((s) => s.sim.entities[entityId]);
  return <EntityControls entityId={entityId} definition={definition} state={state} />;
}

describe('EntityControls', () => {
  beforeEach(() => {
    const p = makeProject({
      devices: [makeDevice('aqara-wireless-mini-switch', 'm1', 0, 0, 'Mando'), makeDevice('aqara-temp-hum', 't1', 0, 0, 'Clima')],
    });
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
  });

  it('los mandos muestran Pulsación, Doble y Mantener', async () => {
    const spy = vi.spyOn(useSimulationStore.getState(), 'pressButton');
    render(<Connected entityId="sensor.mando_action" definition={{ key: 'action', domain: 'sensor', name: 'Acción', initialState: 'none' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Doble' }));
    expect(spy).toHaveBeenCalledWith('sensor.mando_action', 'double');
    expect(screen.getByRole('button', { name: 'Pulsación' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mantener' })).toBeInTheDocument();
  });

  it('el valor numérico refleja cambios externos del estado', () => {
    const def: EntityDefinition = { key: 'temperature', domain: 'sensor', name: 'Temperatura', unit: '°C', initialState: 21 };
    render(<Connected entityId="sensor.clima_temperature" definition={def} />);
    act(() => useSimulationStore.getState().setEntity('sensor.clima_temperature', 25));
    expect(screen.getByLabelText('Nuevo valor de Temperatura')).toHaveValue(25);
  });
});
