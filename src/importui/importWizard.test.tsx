import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useProjectStore } from '../store/projectStore';
import { useLayoutStore } from '../store/layoutStore';
import { useUiStore } from '../store/uiStore';
import { makeProject } from '../test/fixtures';
import { ImportHaWizard } from './ImportHaWizard';
import { detectHaFile, planFor, registryWithOverrides } from './importFiles';
import { AREA_REGISTRY, AUTOMATIONS_YAML, DEVICE_REGISTRY, ENTITY_REGISTRY, SCENES_YAML } from './haFixture';
import { catalog } from '../devices/catalog';

function file(name: string, content: string) {
  return new File([content], name, { type: 'text/plain' });
}

const FILES = () => [
  file('core.device_registry', DEVICE_REGISTRY),
  file('core.area_registry', AREA_REGISTRY),
  file('core.entity_registry', ENTITY_REGISTRY),
  file('automations.yaml', AUTOMATIONS_YAML),
  file('scenes.yaml', SCENES_YAML),
];

beforeEach(() => {
  useProjectStore.getState().loadProject(makeProject({ name: 'Mi casa' }));
  useLayoutStore.getState().reset();
  useUiStore.getState().reset();
});

describe('importar desde HA: ficheros y correcciones', () => {
  it('reconoce los ficheros por nombre o por contenido', () => {
    expect(detectHaFile('automations.yaml', AUTOMATIONS_YAML)).toBe('automationsYaml');
    expect(detectHaFile('registro.json', DEVICE_REGISTRY)).toBe('deviceRegistry');
    expect(detectHaFile('x.json', ENTITY_REGISTRY)).toBe('entityRegistry');
    expect(detectHaFile('notas.txt', 'hola')).toBeNull();
  });

  it('las correcciones fuerzan otra definición o un personalizado', () => {
    const target = catalog.find((d) => d.id === 'aqara-motion-p1');
    if (!target) throw new Error('falta aqara-motion-p1');
    const base = planFor(makeProject(), { deviceRegistry: DEVICE_REGISTRY, entityRegistry: ENTITY_REGISTRY, areaRegistry: AREA_REGISTRY }, {});
    expect(base.matches.find((m) => m.haDeviceId === 'dev-widget')?.custom).toBe(true);
    const forced = planFor(makeProject(), { deviceRegistry: DEVICE_REGISTRY, entityRegistry: ENTITY_REGISTRY, areaRegistry: AREA_REGISTRY }, { 'dev-bulb': { kind: 'custom' } });
    const bulb = forced.matches.find((m) => m.haDeviceId === 'dev-bulb');
    expect(bulb?.custom).toBe(true);
    expect(forced.customDefinitions.find((d) => d.id === bulb?.definitionId)?.model).toBe('TRADFRI bulb E27 WS opal 980lm');
    expect(registryWithOverrides(DEVICE_REGISTRY, { 'dev-widget': { kind: 'definition', definitionId: target.id } }, catalog)).toContain(target.model);
  });
});

describe('asistente «Importar desde Home Assistant»', () => {
  async function toReview() {
    useLayoutStore.getState().setImportHaOpen(true);
    render(<ImportHaWizard />);
    const dialog = screen.getByRole('dialog', { name: 'Importar desde Home Assistant' });
    expect(within(dialog).getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    await userEvent.upload(within(dialog).getByLabelText('Ficheros de Home Assistant'), FILES());
    const loaded = await within(dialog).findByRole('list', { name: 'Ficheros cargados' });
    await waitFor(() => expect(within(loaded).getAllByText('✅')).toHaveLength(5));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }));
    return dialog;
  }

  it('sube, revisa, corrige y fusiona con el proyecto actual (con Deshacer)', async () => {
    const dialog = await toReview();
    // Áreas → salas
    expect(within(dialog).getByText('🏠 Salón')).toBeInTheDocument();
    expect(within(dialog).getByText('🏠 Cocina')).toBeInTheDocument();
    // Dispositivos con su coincidencia
    const devices = within(dialog).getByRole('heading', { name: /Dispositivos \(3\)/ });
    expect(devices).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Equivale a', { selector: '#imp-dev-widget' })).toHaveValue('__custom__');
    expect(within(dialog).getByLabelText('Equivale a', { selector: '#imp-dev-motion' })).toHaveValue('aqara-motion-p1');
    // Corrección: el medidor pasa a ser un enchufe del catálogo
    const plug = catalog.find((d) => d.category === 'plug');
    if (!plug) throw new Error('sin enchufe');
    await userEvent.selectOptions(within(dialog).getByLabelText('Equivale a', { selector: '#imp-dev-widget' }), plug.id);
    expect(within(dialog).getByLabelText('Equivale a', { selector: '#imp-dev-widget' })).toHaveValue(plug.id);
    // Automatizaciones con sus avisos
    expect(within(dialog).getByText('Luz del salón con movimiento')).toBeInTheDocument();
    expect(within(dialog).getByText('Aviso consumo alto')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }));
    expect(within(dialog).getByRole('radio', { name: /Fusionar con el proyecto actual/ })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Importar' }));
    await waitFor(() => expect(useLayoutStore.getState().importHaOpen).toBe(false));
    const p = useProjectStore.getState().project;
    expect(p.name).toBe('Mi casa');
    expect(p.rooms.map((r) => r.name)).toEqual(expect.arrayContaining(['Salón', 'Cocina']));
    expect(p.devices).toHaveLength(3);
    expect(p.devices.find((d) => d.name === 'Medidor cocina')?.definitionId).toBe(plug.id);
    expect(p.automations.map((a) => a.name)).toContain('Luz del salón con movimiento');
    expect(p.scenes.map((s) => s.name)).toContain('Cine');
    expect(useUiStore.getState().notice?.action?.label).toBe('Deshacer');
    act(() => useUiStore.getState().notice?.action?.run());
    expect(useProjectStore.getState().project.devices).toHaveLength(0);
  });

  it('avisa de los ficheros que no reconoce', async () => {
    useLayoutStore.getState().setImportHaOpen(true);
    render(<ImportHaWizard />);
    await userEvent.upload(screen.getByLabelText('Ficheros de Home Assistant'), [file('foto.txt', 'nada')]);
    expect(await screen.findByRole('alert')).toHaveTextContent('«foto.txt» no parece un fichero de Home Assistant');
  });
});
