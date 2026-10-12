import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PackagesDialog } from './PackagesDialog';
import { useProjectStore } from '../store/projectStore';
import { makeDevice, makeProject } from '../test/fixtures';

describe('PackagesDialog', () => {
  beforeEach(() => {
    useProjectStore.getState().loadProject(
      makeProject({
        name: 'Mi casa',
        rooms: [{ id: 'r1', floorId: 'f1', name: 'Salón', polygon: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }] }],
        devices: [{ ...makeDevice('hue-white-e27', 'd1', 100, 100, 'Luz salón'), roomId: 'r1' }],
        automations: [
          {
            id: 'a1',
            name: 'Apagar',
            enabled: true,
            mode: 'single',
            triggers: [{ type: 'time', at: '23:00' }],
            conditions: [],
            actions: [{ type: 'service', service: 'light.turn_off', entityId: 'light.luz_salon' }],
          },
        ],
      }),
    );
  });

  it('previsualiza la guía y los paquetes y descarga el zip', async () => {
    const create = vi.fn((_b: Blob) => 'blob:x');
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<PackagesDialog onClose={() => undefined} />);
    expect(screen.getByRole('heading', { name: /Guía de emparejamiento/ })).toBeInTheDocument();
    const pkg = screen.getByRole('button', { name: /packages\/.*\.yaml/ });
    await userEvent.click(pkg);
    expect(screen.getByRole('region', { name: /Vista previa de packages\// })).toHaveTextContent('light.luz_salon');
    await userEvent.click(screen.getByRole('button', { name: '⬇ Descargar .zip' }));
    expect(create).toHaveBeenCalledTimes(1);
    const blob = create.mock.calls[0]?.[0];
    expect(blob?.type).toBe('application/zip');
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});
