import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OfflineNotice } from './OfflineNotice';
import { DeviceContextMenu } from '../canvas/DeviceContextMenu';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';

describe('Reconectar bloqueado', () => {
  beforeEach(() => {
    const motion = { ...makeDevice('aqara-motion-p1', 'mov', 0, 0, 'Movimiento'), integration: 'zha' as const, protocol: 'zigbee' as const };
    const p = makeProject({
      devices: [makeDevice('ha-green', 'ha', 0, 0, 'Home Assistant'), makeDevice('sonoff-zbdongle-p', 'coord', 0, 0, 'Coordinador Zigbee'), motion],
    });
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
    useUiStore.getState().reset();
  });

  it('con el coordinador caído, «Reconectar» del hijo está desactivado y explica el motivo', async () => {
    act(() => useSimulationStore.getState().setFailures({ devicesDown: ['coord'] }));
    render(<OfflineNotice deviceId="mov" />);
    expect(screen.getByRole('button', { name: 'Reconectar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reconectar' })).toHaveAccessibleDescription('Depende de «Coordinador Zigbee»');

    act(() => useSimulationStore.getState().setFailures({ devicesDown: [] }));
    expect(screen.getByRole('button', { name: 'Reconectar' })).toBeEnabled();
  });

  it('en el menú contextual, la entrada aparece desactivada con el motivo', async () => {
    act(() => useSimulationStore.getState().setDeviceOffline('coord', true));
    act(() => useUiStore.getState().openContextMenu({ deviceId: 'mov', x: 10, y: 10 }));
    render(<DeviceContextMenu />);
    const item = within(screen.getByRole('menu')).getByRole('menuitem', { name: /Reconectar/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveTextContent('Depende de «Coordinador Zigbee»');
    await userEvent.click(item);
    expect(useSimulationStore.getState().sim.offline?.mov).toBeDefined();
  });
});
