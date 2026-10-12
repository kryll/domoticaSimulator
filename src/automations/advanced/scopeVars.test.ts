import { ROOT_SCOPE, availableVariables, insertAt, scopeForItem } from './scopeVars';
import type { Action } from '../../types';

const seq: Action[] = [
  { type: 'variables', variables: { minutos: 10 } },
  { type: 'notify', message: '' },
  { type: 'variables', variables: { zona: 'salón' } },
];

describe('scopeVars', () => {
  it('nivel superior: solo las variables definidas antes', () => {
    expect(scopeForItem(ROOT_SCOPE, seq, 1).topLevel).toEqual(['minutos']);
    expect(scopeForItem(ROOT_SCOPE, seq, 0).topLevel).toEqual([]);
  });

  it('locales dentro de un repeat, con repeat.index y trigger.*', () => {
    const inner = { ...scopeForItem({ ...ROOT_SCOPE, triggerTypes: ['state'] }, seq, 2), depth: 1, inRepeat: true };
    const scoped = scopeForItem(inner, [{ type: 'variables', variables: { n: 1 } }], 1);
    const names = availableVariables(scoped).map((v) => v.name);
    expect(names).toEqual(['n', 'minutos', 'repeat.index', 'trigger.platform', 'trigger.entity_id', 'trigger.from_state.state', 'trigger.to_state.state']);
  });

  it('sin disparadores (scripts) no hay trigger.*', () => {
    expect(availableVariables(ROOT_SCOPE)).toEqual([]);
  });

  it('inserta en el cursor con un espacio', () => {
    expect(insertAt('Hola', '{{ x }}')).toEqual({ text: 'Hola {{ x }}', caret: 12 });
    expect(insertAt('ab', '{{ x }}', 1, 1).text).toBe('a {{ x }}b');
  });
});
