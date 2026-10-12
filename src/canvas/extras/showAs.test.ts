import { setShowAs } from './showAs';
import { makeDevice, makeProject } from '../../test/fixtures';

describe('setShowAs', () => {
  it('muestra el relé como luz y actualiza automatizaciones y grupos', () => {
    const project = makeProject({
      devices: [makeDevice('sonoff-minir4', 'd1', 0, 0, 'Relé')],
      automations: [
        { id: 'a1', name: 'x', enabled: true, mode: 'single', triggers: [], conditions: [], actions: [{ type: 'service', service: 'switch.turn_on', entityId: 'switch.rele' }] },
      ],
      groups: [{ id: 'g1', name: 'Todo', domain: 'switch', entityIds: ['switch.rele'] }],
    });
    const next = setShowAs(project, 'd1', 'light');
    expect(next.devices[0]?.showAs).toBe('light');
    expect(next.automations[0]?.actions[0]).toMatchObject({ entityId: 'light.rele' });
    expect(next.groups?.[0]?.entityIds).toEqual(['light.rele']);
    const back = setShowAs(next, 'd1', undefined);
    expect(back.devices[0]?.showAs).toBeUndefined();
    expect(back.automations[0]?.actions[0]).toMatchObject({ entityId: 'switch.rele' });
  });
});
