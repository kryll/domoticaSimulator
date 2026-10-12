import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';
import { confirmDialog } from './confirm';
import { SaveConflictDialog, SaveErrorBanner, SaveIndicator } from './SaveIndicator';
import { VersionsDialog } from './VersionsDialog';
import { Modal } from './Modal';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { saveVersion, listVersions } from '../store/versions';
import { startAutosave, type AutosaveDeps } from '../store/autosave';
import { makeDevice, makeProject } from '../test/fixtures';

describe('ConfirmDialog', () => {
  it('es un alertdialog con el foco en Cancelar si es destructivo; Escape cancela sin cerrar el modal de debajo', async () => {
    const onClose = vi.fn();
    render(
      <>
        <Modal open title="Debajo" onClose={onClose}>
          contenido
        </Modal>
        <ConfirmDialog />
      </>,
    );
    let answer: Promise<boolean> = Promise.resolve(true);
    act(() => {
      answer = confirmDialog({ title: '¿Borrar la planta?', message: 'Se borrarán sus salas.', details: ['Automatización «A»'], confirmLabel: 'Borrar', danger: true });
    });
    const dialog = await screen.findByRole('alertdialog', { name: '¿Borrar la planta?' });
    expect(dialog).toHaveAccessibleDescription(/Se borrarán sus salas/);
    expect(within(dialog).getByText('Automatización «A»')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    // El foco no se escapa del diálogo
    await userEvent.tab();
    expect(within(dialog).getByRole('button', { name: 'Borrar' })).toHaveFocus();
    await userEvent.tab();
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(await answer).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('resuelve true al confirmar y atiende las peticiones en cola', async () => {
    render(<ConfirmDialog />);
    let first: Promise<boolean> = Promise.resolve(false);
    let second: Promise<boolean> = Promise.resolve(false);
    act(() => {
      first = confirmDialog({ title: 'Primera' });
      second = confirmDialog({ title: 'Segunda' });
    });
    expect(screen.getByRole('button', { name: 'Aceptar' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Aceptar' }));
    expect(await first).toBe(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(await second).toBe(false);
  });
});

describe('indicador de guardado', () => {
  beforeEach(() => useProjectStore.getState().loadProject(makeProject()));

  it('muestra Guardado, Guardando… y Error con reintento y descarga de copia', async () => {
    const deps: AutosaveDeps = {
      save: vi.fn(async () => ({ ok: true as const, revision: 1 })),
      load: async () => undefined,
      channel: () => null,
      autoVersion: async () => undefined,
      now: () => 0,
    };
    const stop = startAutosave(60_000, deps);
    render(
      <>
        <SaveIndicator />
        <SaveErrorBanner />
      </>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Guardado');
    act(() => useProjectStore.getState().renameProject('Cambio'));
    expect(screen.getByRole('status')).toHaveTextContent('Guardando…');
    act(() => useProjectStore.getState().setSaveState({ saveStatus: 'error', saveError: 'Sin espacio' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('No se ha podido guardar el proyecto en el navegador (Sin espacio)');
    expect(within(alert).getByRole('button', { name: 'Descargar copia JSON' })).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(deps.save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Guardado');
    stop();
  });

  it('el diálogo de conflicto ofrece las tres opciones', async () => {
    const save = vi.fn(async () => ({ ok: true as const, revision: 1 }));
    const stop = startAutosave(60_000, { save, load: async () => makeProject({ name: 'Reciente', revision: 5 }), channel: () => null, autoVersion: async () => undefined, now: () => 0 });
    render(<SaveConflictDialog />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    act(() => useProjectStore.getState().setSaveState({ conflict: { reason: 'other-tab', revision: 5 } }));
    const dialog = screen.getByRole('alertdialog', { name: 'Este proyecto se ha modificado en otra pestaña' });
    expect(within(dialog).getByRole('button', { name: 'Cargar la versión más reciente' })).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Mantener la mía y sobrescribir' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Guardar la mía como copia' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cargar la versión más reciente' }));
    await waitFor(() => expect(useProjectStore.getState().project.name).toBe('Reciente'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    stop();
  });
});

describe('Historial de versiones', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    useProjectStore.getState().loadProject(makeProject({ id: 'pv', devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz')] }));
  });

  it('guarda con etiqueta, compara, restaura (con deshacer y copia previa) y borra', async () => {
    render(
      <>
        <VersionsDialog />
        <ConfirmDialog />
      </>,
    );
    await screen.findByText('Todavía no hay versiones guardadas.');
    await userEvent.type(screen.getByLabelText('Etiqueta (opcional)'), 'Con una luz');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar versión ahora' }));
    const list = await screen.findByRole('list', { name: 'Versiones' });
    expect(within(list).getByText('Con una luz')).toBeInTheDocument();
    expect(within(list).getByText('Manual')).toBeInTheDocument();
    expect(within(list).getByText(/1 dispositivo/)).toBeInTheDocument();

    act(() => useProjectStore.getState().addDevice(makeDevice('aqara-motion-p1', 'd2', 50, 50, 'Sensor')));
    await userEvent.click(within(list).getByRole('button', { name: /^Comparar con la actual/ }));
    expect(await screen.findByRole('region', { name: 'Diferencias con la actual' })).toHaveTextContent('Dispositivos: 1 añadido (Sensor)');

    await userEvent.click(within(list).getByRole('button', { name: /^Restaurar/ }));
    await waitFor(() => expect(useProjectStore.getState().project.devices.map((d) => d.id)).toEqual(['d1']));
    expect(useUiStore.getState().notice?.action?.label).toBe('Deshacer');
    // antes de restaurar se guardó una copia automática de lo que había
    const versions = await listVersions('pv');
    expect(versions.some((v) => v.auto && v.label === 'Antes de restaurar')).toBe(true);
    act(() => useProjectStore.getState().undo());
    expect(useProjectStore.getState().project.devices).toHaveLength(2);
  });

  it('borra una versión tras confirmar', async () => {
    useProjectStore.getState().loadProject(makeProject({ id: 'pv2' }));
    await saveVersion(useProjectStore.getState().project, { auto: true });
    render(
      <>
        <VersionsDialog />
        <ConfirmDialog />
      </>,
    );
    const list = await screen.findByRole('list', { name: 'Versiones' });
    expect(within(list).getByText('Automática')).toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: /^Borrar/ }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Borrar' }));
    await screen.findByText('Todavía no hay versiones guardadas.');
  });
});
