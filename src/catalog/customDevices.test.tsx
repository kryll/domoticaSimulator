import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactFlowProvider } from '@xyflow/react';
import { useProjectStore } from '../store/projectStore';
import { useLayoutStore } from '../store/layoutStore';
import { makeProject } from '../test/fixtures';
import { catalog } from '../devices/catalog';
import { CatalogPanel } from './CatalogPanel';
import { CustomDeviceEditor } from './CustomDeviceEditor';
import { customIdFor, parseInitialState, saveCustomDefinition } from './customDevices';
import { definitionOf } from '../canvas/analysis';

beforeEach(() => {
  useProjectStore.getState().loadProject(makeProject());
  useLayoutStore.getState().reset();
});

function renderCatalog() {
  return render(
    <ReactFlowProvider>
      <CatalogPanel onAdd={() => undefined} />
    </ReactFlowProvider>,
  );
}

describe('dispositivos personalizados: modelo', () => {
  it('genera ids «custom:» únicos y lee el estado inicial', () => {
    const p = makeProject();
    expect(customIdFor({ brand: 'Tuya', model: 'TS011F', name: '', id: '' }, p)).toBe('custom:tuya-ts011f');
    const def = { ...(catalog[0] as (typeof catalog)[number]), id: 'custom:tuya-ts011f' };
    const p2 = saveCustomDefinition(p, def);
    expect(customIdFor({ brand: 'Tuya', model: 'TS011F', name: '', id: '' }, p2)).toBe('custom:tuya-ts011f-2');
    expect(parseInitialState('21,5')).toBe(21.5);
    expect(parseInitialState('on')).toBe('on');
    expect(parseInitialState('true')).toBe(true);
  });
});

describe('dispositivos personalizados: interfaz', () => {
  it('«+ Dispositivo personalizado» abre el editor, valida y guarda en el proyecto con Deshacer', async () => {
    renderCatalog();
    await userEvent.click(screen.getByRole('button', { name: '+ Dispositivo personalizado' }));
    expect(useLayoutStore.getState().customDevice).toEqual({ mode: 'new' });
    render(<CustomDeviceEditor />);
    const dialog = screen.getByRole('dialog', { name: 'Dispositivo personalizado' });
    // sin modelo no se puede guardar
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar dispositivo' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Indica el modelo');
    await userEvent.type(within(dialog).getByLabelText('Modelo'), 'Enchufe X1');
    await userEvent.type(within(dialog).getByLabelText('Precio (€)'), '12');
    await userEvent.click(within(dialog).getByRole('button', { name: '+ Añadir entidad' }));
    const second = within(dialog).getByRole('listitem', { name: 'Entidad 2' });
    await userEvent.clear(within(second).getByLabelText('Clave'));
    await userEvent.type(within(second).getByLabelText('Clave'), 'power');
    await userEvent.type(within(second).getByLabelText('device_class'), 'power');
    await userEvent.type(within(second).getByLabelText('Unidad'), 'W');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar dispositivo' }));
    const defs = useProjectStore.getState().project.customDefinitions ?? [];
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ id: 'custom:tuya-enchufe-x1', model: 'Enchufe X1', priceEur: 12 });
    expect(defs[0]?.entities[1]).toMatchObject({ key: 'power', domain: 'sensor', deviceClass: 'power', unit: 'W', initialState: 0 });
    act(() => useProjectStore.getState().undo());
    expect(useProjectStore.getState().project.customDefinitions ?? []).toHaveLength(0);
  });

  it('avisa del JSON de capacidades no válido', async () => {
    useLayoutStore.getState().openCustomDevice({ mode: 'new' });
    render(<CustomDeviceEditor />);
    await userEvent.type(screen.getByLabelText('Modelo'), 'M');
    await userEvent.type(screen.getByLabelText('Capacidades (JSON, opcional)'), '{{no');
    expect(screen.getByText('JSON no válido')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar dispositivo' }));
    expect(screen.getByRole('alert')).toHaveTextContent('capacidades con JSON no válido');
  });

  it('«Clonar y editar» copia la tarjeta y el filtro «Personalizados» la muestra', async () => {
    const source = catalog.find((d) => d.category === 'light') ?? catalog[0];
    if (!source) throw new Error('catálogo vacío');
    renderCatalog();
    const card = screen.getAllByRole('listitem', { name: `${source.brand} ${source.name}` })[0];
    if (!card) throw new Error('sin tarjeta');
    await userEvent.click(within(card).getByRole('button', { name: `Clonar y editar ${source.name}` }));
    expect(useLayoutStore.getState().customDevice).toEqual({ mode: 'clone', definitionId: source.id });
    const editor = render(<CustomDeviceEditor />);
    expect(screen.getByLabelText('Nombre')).toHaveValue(`${source.name} (copia)`);
    expect(screen.getAllByRole('listitem', { name: /^Entidad / })).toHaveLength(source.entities.length);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar dispositivo' }));
    editor.unmount();
    const saved = useProjectStore.getState().project.customDefinitions?.[0];
    expect(saved?.id.startsWith('custom:')).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText('Origen'), 'custom');
    const results = screen.getByRole('list', { name: 'Resultados del catálogo' });
    expect(within(results).getAllByRole('listitem')).toHaveLength(1);
    expect(within(results).getByText('Personalizado')).toBeInTheDocument();
    // Un dispositivo del plano con esa definición la encuentra (lienzo, propiedades, motor).
    expect(definitionOf({ id: 'd', definitionId: saved?.id ?? '', name: 'x', floorId: 'f1', position: { x: 0, y: 0 }, protocol: 'zigbee', integration: 'zha' })?.name).toBe(saved?.name);
    // Pinta el catálogo entero (más de 150 tarjetas) varias veces: más margen que los 5 s por defecto.
  }, 15_000);
});
