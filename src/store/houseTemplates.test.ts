import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { validateProject } from '../network/validator';
import { parseProject } from './projectSchema';
import { createFromTemplate, HOUSE_TEMPLATES } from './houseTemplates';

describe('plantillas de casa', () => {
  it('hay tres plantillas', () => {
    expect(HOUSE_TEMPLATES.map((t) => t.id)).toEqual(['piso-2-dormitorios', 'unifamiliar-2-plantas', 'oficina-pequena']);
  });

  it.each(HOUSE_TEMPLATES.map((t) => t.id))('%s pasa el validador sin errores ni avisos', (id) => {
    const p = createFromTemplate(id);
    const issues = validateProject(p, catalog).filter((i) => i.severity !== 'info');
    expect(issues).toEqual([]);
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(p.devices.every((d) => p.rooms.some((r) => r.id === d.roomId))).toBe(true);
  });

  it('ids únicos en cada creación y error si no existe', () => {
    const a = createFromTemplate('piso-2-dormitorios');
    const b = createFromTemplate('piso-2-dormitorios');
    expect(a.floors[0]?.id).not.toBe(b.floors[0]?.id);
    expect(() => createFromTemplate('castillo')).toThrow(/desconocida/);
  });
});
