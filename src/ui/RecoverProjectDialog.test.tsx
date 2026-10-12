import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { get, set } from 'idb-keyval';
import { RecoverProjectDialog } from './RecoverProjectDialog';
import { useRecoveryStore } from '../store/recoveryStore';
import { useProjectStore } from '../store/projectStore';
import { projectsStore } from '../store/persistence';
import { saveVersion } from '../store/versions';
import { makeDevice, makeProject } from '../test/fixtures';

describe('Proyecto ilegible al arrancar', () => {
  const good = makeProject({ id: 'dañado', name: 'Mi casa', devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz')] });
  const raw = { ...JSON.parse(JSON.stringify(good)), devices: [...JSON.parse(JSON.stringify(good.devices)), { id: 'x', name: 1 }], floors: JSON.parse(JSON.stringify(good.floors)) };

  beforeEach(async () => {
    await set('dañado', raw, projectsStore());
    useRecoveryStore.getState().setUnreadable({ id: 'dañado', name: 'Mi casa', error: 'Proyecto no válido: devices[1].name debe ser un texto', raw });
  });

  it('muestra el error y repara sin sobrescribir el proyecto dañado', async () => {
    render(<RecoverProjectDialog />);
    expect(screen.getByRole('alert')).toHaveTextContent('«Mi casa» está dañado');
    await userEvent.click(screen.getByRole('button', { name: 'Intentar reparar' }));
    await vi.waitFor(() => expect(useRecoveryStore.getState().unreadable).toBeNull());
    const opened = useProjectStore.getState().project;
    expect(opened.name).toBe('Mi casa (reparado)');
    expect(opened.id).not.toBe('dañado');
    expect(opened.devices.map((d) => d.id)).toEqual(['d1']);
    expect(await get('dañado', projectsStore())).toEqual(raw);
    expect(useRecoveryStore.getState().unreadable).toBeNull();
  });

  it('abre la última versión válida del historial como proyecto nuevo', async () => {
    await saveVersion({ ...good, name: 'Copia buena' }, { auto: true });
    render(<RecoverProjectDialog />);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir la última versión válida' }));
    await vi.waitFor(() => expect(useProjectStore.getState().project.name).toBe('Mi casa (recuperado)'));
    expect(useProjectStore.getState().project.id).not.toBe('dañado');
    expect(await get('dañado', projectsStore())).toEqual(raw);
  });

  it('ofrece descargar el JSON en bruto', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<RecoverProjectDialog />);
    await userEvent.click(screen.getByRole('button', { name: 'Descargar el JSON en bruto' }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});
