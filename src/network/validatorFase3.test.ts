import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { createDemoProject } from '../store/demoProject';
import { validateProject } from './validator';

const codes = (p: ReturnType<typeof createDemoProject>) => validateProject(p, catalog).map((i) => i.code);

describe('validador: reglas de la Fase 3', () => {
  it('la demo con personas, zonas y grupos no tiene errores nuevos', () => {
    expect(codes(createDemoProject()).filter((c) => ['persona-desconocida', 'zona-desconocida', 'grupo-entidad-desconocida', 'entidad-desconocida'].includes(c))).toEqual([]);
  });

  it('detecta personas, zonas y miembros de grupo inexistentes', () => {
    const demo = createDemoProject();
    const p = {
      ...demo,
      automations: [
        ...demo.automations,
        { id: 'x', name: 'X', enabled: true, mode: 'single' as const, triggers: [{ type: 'zone' as const, personId: 'nadie', zoneId: 'marte', event: 'enter' as const }], conditions: [{ type: 'not' as const, conditions: [{ type: 'zone' as const, personId: 'demo-ana', zoneId: 'luna' }] }], actions: [] },
      ],
      groups: [{ id: 'g', name: 'G', domain: 'light' as const, entityIds: ['light.no_existe', 'media_player.televisor'] }],
    };
    const c = codes(p);
    expect(c).toContain('persona-desconocida');
    expect(c.filter((x) => x === 'zona-desconocida')).toHaveLength(2);
    expect(c).toContain('grupo-entidad-desconocida');
    expect(c).toContain('grupo-dominio-mezclado');
  });
});
