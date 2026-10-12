import { startSimulationSync, stopSimulationLoop, useSimulationStore } from './simulationStore';
import { useProjectStore } from './projectStore';
import { addPerson, movePersonTo, removePerson, updatePerson } from '../people/personActions';
import { makeDevice, makeProject } from '../test/fixtures';
import type { Automation } from '../types';

const sim = () => useSimulationStore.getState().sim;

const auto = (entityId: string): Automation => ({
  id: 'a1',
  name: 'x',
  enabled: true,
  mode: 'single',
  triggers: [{ type: 'state', entityId, to: 'not_home' }],
  conditions: [],
  actions: [{ type: 'service', service: 'light.turn_off', entityId: 'light.grupo_luces' }],
});

describe('renombrar personas y grupos (proyecto y simulación)', () => {
  let stop: () => void;
  beforeEach(() => {
    const p = makeProject({
      devices: [makeDevice('hue-white-e27', 'd1', 0, 0, 'Luz')],
      people: [{ id: 'ana', name: 'Ana' }],
      groups: [{ id: 'g', name: 'Luces', domain: 'light', entityIds: ['light.luz'] }],
      automations: [auto('person.ana')],
    });
    useProjectStore.getState().loadProject(p);
    useSimulationStore.getState().reset(p);
    stop = startSimulationSync();
  });
  afterEach(() => {
    stop();
    stopSimulationLoop();
  });

  it('renombrar una persona traslada referencias y estado en un solo paso de deshacer', () => {
    movePersonTo('ana', '');
    updatePerson('ana', { name: 'Ana María' });
    const p = useProjectStore.getState().project;
    expect(p.automations[0]?.triggers[0]).toMatchObject({ entityId: 'person.ana_maria' });
    expect(sim().entities['person.ana_maria']?.state).toBe('not_home');
    expect(sim().entities['person.ana']).toBeUndefined();
    expect(sim().entities['zone.home']?.state).toBe(0);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.people?.[0]?.name).toBe('Ana');
    expect(useProjectStore.getState().project.automations[0]?.triggers[0]).toMatchObject({ entityId: 'person.ana' });
  });

  it('zone.home cuenta bien al añadir y borrar personas', () => {
    expect(sim().entities['zone.home']?.state).toBe(1);
    const luis = addPerson('Luis');
    expect(sim().entities['zone.home']?.state).toBe(2);
    removePerson(luis.id);
    expect(sim().entities['zone.home']?.state).toBe(1);
    expect(sim().entities['person.luis']).toBeUndefined();
  });
});
