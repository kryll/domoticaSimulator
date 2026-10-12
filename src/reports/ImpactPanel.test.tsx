import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImpactPanel } from './ImpactPanel';
import { ScenariosMenu } from '../simulation/ScenariosMenu';
import { FailureBanner } from '../simulation/FailureBanner';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';

describe('Escenarios de fallo e impacto', () => {
  beforeEach(() => {
    const p = makeProject({
      devices: [makeDevice('tuya-wifi-plug', 'b1', 0, 0, 'Enchufe'), makeDevice('hue-white-e27', 'h1', 200, 0, 'Luz Hue')],
      automations: [
        {
          id: 'a1',
          name: 'Luz con el enchufe',
          enabled: true,
          mode: 'single',
          triggers: [{ type: 'state', entityId: 'switch.enchufe_switch', to: 'on' }],
          conditions: [],
          actions: [{ type: 'service', service: 'light.turn_on', entityId: 'light.luz_hue' }],
        },
      ],
    });
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
    useUiStore.getState().reset();
  });

  it('sin fallos, el panel invita a usar el menú Escenarios', () => {
    render(<ImpactPanel />);
    expect(screen.getByText(/No hay fallos activos/)).toBeInTheDocument();
  });

  it('el escenario «Sin Internet» muestra la banda y marca la automatización como rota', async () => {
    render(
      <>
        <ScenariosMenu />
        <FailureBanner />
        <ImpactPanel />
      </>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Escenarios/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Escenarios de fallo' });
    await userEvent.click(await within(dialog).findByRole('switch', { name: /Sin Internet/ }));
    expect(useSimulationStore.getState().sim.failures?.internet).toBe(true);

    expect(screen.getByRole('status', { name: 'Modo fallo' })).toHaveTextContent('Sin Internet');
    const automations = screen.getByRole('region', { name: 'Automatizaciones' });
    const row = within(automations).getByText('Luz con el enchufe').closest('li');
    expect(row).toHaveAttribute('data-status', 'broken');
    expect(row).toHaveTextContent('Rota');
    const devices = screen.getByRole('region', { name: 'Dispositivos no disponibles' });
    expect(within(devices).getByText('Enchufe')).toBeInTheDocument();

    // clic en la automatización: se selecciona y se centran sus dispositivos
    await userEvent.click(within(automations).getByRole('button', { name: /^Rota.*Luz con el enchufe/ }));
    expect(useUiStore.getState().selectedAutomationId).toBe('a1');
    expect(useUiStore.getState().focusRequest?.deviceIds).toContain('b1');

    // Restaurar todo quita la banda
    await userEvent.click(within(screen.getByRole('status', { name: 'Modo fallo' })).getByRole('button', { name: 'Restaurar todo' }));
    expect(screen.queryByRole('status', { name: 'Modo fallo' })).toBeNull();
  });
});
