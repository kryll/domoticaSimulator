import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ValidationPanel } from './ValidationPanel';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { makeDevice, makeProject } from '../test/fixtures';
import type { ValidationIssue } from '../types';

const issues: ValidationIssue[] = [
  { id: 'i1', severity: 'error', code: 'zigbee-sin-coordinador', message: 'Falta coordinador Zigbee', deviceIds: ['d1'] },
  { id: 'i2', severity: 'warning', code: 'cloud', message: 'Depende de la nube', deviceIds: [] },
  { id: 'i3', severity: 'warning', code: 'otro', message: 'Otro aviso', deviceIds: [] },
];

describe('ValidationPanel', () => {
  beforeEach(() => {
    useUiStore.getState().reset();
    useProjectStore.getState().loadProject(makeProject({ devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Bombilla')] }));
  });

  it('agrupa las incidencias por severidad', () => {
    render(<ValidationPanel issues={issues} />);
    expect(screen.getByRole('heading', { name: 'Errores (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Avisos (2)' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Información/ })).not.toBeInTheDocument();
  });

  it('al pulsar una incidencia selecciona y enfoca sus dispositivos', async () => {
    render(<ValidationPanel issues={issues} />);
    await userEvent.click(screen.getByRole('button', { name: /Falta coordinador Zigbee/ }));
    const ui = useUiStore.getState();
    expect(ui.selection).toEqual({ kind: 'device', id: 'd1' });
    expect(ui.focusRequest?.deviceIds).toEqual(['d1']);
    expect(ui.highlightedDeviceIds).toEqual(['d1']);
  });

  it('muestra un mensaje cuando no hay incidencias', () => {
    render(<ValidationPanel issues={[]} />);
    expect(screen.getByText(/Sin incidencias/)).toBeInTheDocument();
  });
});
