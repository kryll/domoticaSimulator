import { disambiguate, entityLabel } from './entityLabel';

describe('entityLabel', () => {
  it('une dispositivo y entidad', () => {
    expect(entityLabel('Clima dormitorio', 'Humedad')).toBe('Clima dormitorio · Humedad');
  });
  it('no repite el nombre', () => {
    expect(entityLabel('Termostato', 'Termostato')).toBe('Termostato');
    expect(entityLabel('Luz salón', 'Luz')).toBe('Luz salón');
    expect(entityLabel('Sensor', 'Batería', true)).toBe('Sensor');
  });
  it('desambigua etiquetas repetidas con el entity_id', () => {
    const out = disambiguate([
      { entityId: 'a.x', label: 'X' },
      { entityId: 'b.x', label: 'X' },
      { entityId: 'c.y', label: 'Y' },
    ]);
    expect(out.map((o) => o.label)).toEqual(['X (a.x)', 'X (b.x)', 'Y']);
  });
});
