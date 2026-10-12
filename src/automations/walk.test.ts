import { describe, expect, it } from 'vitest';
import type { Action, Condition, Trigger } from '../types';
import {
  actionConditions,
  actionEntityIds,
  childActions,
  conditionEntityIds,
  flattenActions,
  mapActionEntities,
  mapConditionEntities,
  mapTemplateEntities,
  mapTriggerEntities,
  remapServiceDomain,
  triggerEntityIds,
} from './walk';

const map = (id: string): string => ({ 'light.a': 'light.b', 'switch.r': 'light.r' })[id] ?? id;

const tree: Action[] = [
  {
    type: 'choose',
    choices: [{ conditions: [{ type: 'state', entityId: 'light.a', state: 'on' }], sequence: [{ type: 'service', service: 'switch.turn_on', entityId: 'switch.r', data: { message: "{{ states('light.a') }}" } }] }],
    default: [{ type: 'repeat', count: 2, while: [{ type: 'numeric_state', entityId: 'sensor.t', above: 1 }], until: [{ type: 'not', conditions: [{ type: 'state', entityId: 'light.a', state: 'off' }] }], sequence: [{ type: 'delay', seconds: 1 }] }],
  },
  { type: 'if', conditions: [{ type: 'or', conditions: [{ type: 'state', entityId: 'light.a', state: 'on' }] }], then: [], else: [{ type: 'wait_for_trigger', triggers: [{ type: 'device_action', entityId: 'sensor.m', action: 'single' }] }] },
  { type: 'notify', title: "{{ state_attr('light.a', 'brightness') }}", message: '{{ is_state("light.a", "on") }} light.a sin plantilla' },
  { type: 'variables', variables: { x: "{{ states('light.a') }}", n: 1 } },
];

describe('walk', () => {
  it('recorre y aplana', () => {
    expect(flattenActions(tree).map((a) => a.type)).toEqual(['choose', 'service', 'repeat', 'delay', 'if', 'wait_for_trigger', 'notify', 'variables']);
    expect(childActions(tree[0]!).map((a) => a.type)).toEqual(['service', 'repeat']);
    expect(actionConditions(tree[1]!)).toHaveLength(1);
    expect(actionEntityIds(tree)).toEqual(['light.a', 'switch.r', 'sensor.t', 'light.a', 'light.a', 'sensor.m']);
    expect(triggerEntityIds({ type: 'time', at: '10:00' })).toEqual([]);
    expect(conditionEntityIds({ type: 'zone', personId: 'p', zoneId: 'z' })).toEqual([]);
  });

  it('mapea entidades, servicios y plantillas', () => {
    const out = tree.map((a) => mapActionEntities(a, map));
    const json = JSON.stringify(out);
    expect(json.replaceAll('light.a sin plantilla', '')).not.toContain('light.a');
    expect(json).toContain('light.a sin plantilla');
    expect(json).toContain('"service":"light.turn_on","entityId":"light.r"');
    // fuera de {{ }} no se toca el texto
    expect(mapTemplateEntities('light.a {{ states("light.a") }}', map)).toBe('light.a {{ states("light.b") }}');
    expect(mapTemplateEntities('sin plantillas', map)).toBe('sin plantillas');
    const t: Trigger = { type: 'state', entityId: 'light.a', to: 'on' };
    expect(mapTriggerEntities(t, map)).toMatchObject({ entityId: 'light.b' });
    const c: Condition = { type: 'not', conditions: [{ type: 'state', entityId: 'light.a', state: 'on' }] };
    expect(JSON.stringify(mapConditionEntities(c, map))).toContain('light.b');
  });

  it('remapServiceDomain', () => {
    expect(remapServiceDomain('switch.turn_on', 'switch.r', 'light.r')).toBe('light.turn_on');
    expect(remapServiceDomain('homeassistant.turn_on', 'switch.r', 'light.r')).toBe('homeassistant.turn_on');
    expect(remapServiceDomain('turn_on', 'switch.r', 'light.r')).toBe('turn_on');
    expect(remapServiceDomain('light.turn_on', 'light.a', 'light.b')).toBe('light.turn_on');
  });
});
