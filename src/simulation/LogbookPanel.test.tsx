import { act, render, screen } from '@testing-library/react';
import { LogbookPanel } from './LogbookPanel';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { makeProject } from '../test/fixtures';

describe('LogbookPanel', () => {
  it('muestra las notificaciones con su icono y título', () => {
    const p = makeProject({
      scripts: [{ id: 's1', name: 'Aviso', sequence: [{ type: 'service', service: 'notify.persistent_notification', entityId: '', data: { title: 'Casa', message: 'Puerta abierta' } }] }],
    });
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
    render(<LogbookPanel />);
    act(() => useSimulationStore.getState().runScript('s1'));
    const entry = screen.getByTestId('log-notification');
    expect(entry).toHaveTextContent('Casa: Puerta abierta');
    expect(screen.getByRole('img', { name: 'Notificación' })).toBeInTheDocument();
  });
});
