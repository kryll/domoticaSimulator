import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { def, dev, FLOOR, FLOOR_UP, project } from '../devices/testUtils';
import type { Connection } from '../types';
import { canConnect, isWiredLink, suggestConnections } from './connections';
import { coverageRadiusPx, distanceMeters, isInRange, rangeForProtocol, rangeMeters } from './coverage';
import { analyzeMesh } from './mesh';

const conn = (id: string, sourceId: string, targetId: string, protocol: Connection['protocol']): Connection => ({ id, sourceId, targetId, protocol });

describe('coverage', () => {
  it('distanceMeters usa la escala de la planta', () => {
    expect(distanceMeters({ x: 0, y: 0 }, { x: 300, y: 400 }, FLOOR)).toBe(10);
    expect(distanceMeters({ x: 0, y: 0 }, { x: 10, y: 0 }, { ...FLOOR, pixelsPerMeter: 0 })).toBe(10);
  });

  it('coverageRadiusPx = alcance × píxeles por metro', () => {
    expect(coverageRadiusPx(def('tplink-deco-x50'), FLOOR)).toBe(1500);
    expect(coverageRadiusPx(def('reolink-rlc-810a'), FLOOR)).toBe(0);
  });

  it('rangeMeters y rangeForProtocol usan valores por defecto', () => {
    expect(rangeMeters(def('ha-green'))).toBe(0);
    expect(rangeForProtocol(def('shelly-plug-s-gen3'), 'ble')).toBe(10);
    expect(rangeForProtocol(def('shelly-plug-s-gen3'), 'wifi')).toBe(30);
    expect(rangeForProtocol(def('google-nest-hub-2'), 'thread')).toBe(20);
  });

  it('isInRange respeta distancia, mayor alcance y atenuación entre plantas', () => {
    const ap = dev('ap', 'tplink-deco-x50', { x: 0, y: 0 });
    const near = dev('n', 'tapo-p110', { x: 1000, y: 0 });
    const far = dev('f', 'tapo-p110', { x: 1600, y: 0 });
    const up = dev('u', 'tapo-p110', { x: 1000, y: 0 }, { floorId: FLOOR_UP.id });
    const floors = [FLOOR, FLOOR_UP];
    expect(isInRange(ap, near, catalog, floors)).toBe(true);
    expect(isInRange(ap, far, catalog, floors)).toBe(false);
    // 20 m en horizontal + 3 m de altura = 20,2 m > 30 × 0,7 = 21 → dentro; a 22 m fuera.
    expect(isInRange(ap, up, catalog, floors)).toBe(true);
    expect(isInRange(ap, { ...up, position: { x: 1100, y: 0 } }, catalog, floors)).toBe(false);
  });

  it('isInRange es falso si falta definición o planta', () => {
    const a = dev('a', 'tapo-p110');
    expect(isInRange(a, { ...a, id: 'b', definitionId: 'nada' }, catalog, [FLOOR])).toBe(false);
    expect(isInRange(a, { ...a, id: 'b', floorId: 'nada' }, catalog, [FLOOR])).toBe(false);
  });
});

describe('canConnect', () => {
  const ok = (a: Parameters<typeof canConnect>[0], b: Parameters<typeof canConnect>[1]) => canConnect(a, b, catalog);

  it('Wi-Fi con punto de acceso', () => {
    expect(ok(dev('p', 'tapo-p110'), dev('ap', 'tplink-deco-x50'))).toEqual({ ok: true, protocol: 'wifi' });
    expect(ok(dev('p', 'tapo-p110m'), dev('ap', 'tplink-deco-x50'))).toEqual({ ok: true, protocol: 'matter' });
  });

  it('Wi-Fi con un hub que no es punto de acceso: no', () => {
    const r = ok(dev('p', 'tapo-p110'), dev('h', 'aqara-hub-m2'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/punto de acceso/);
  });

  it('Zigbee ZHA con coordinador, y con hub propietario solo si usa su integración', () => {
    const zha = dev('s', 'aqara-motion-p1', undefined, { integration: 'zha' });
    const native = dev('n', 'aqara-motion-p1');
    expect(ok(zha, dev('c', 'sonoff-zbdongle-p'))).toEqual({ ok: true, protocol: 'zigbee' });
    expect(ok(native, dev('h', 'aqara-hub-m2'))).toEqual({ ok: true, protocol: 'zigbee' });
    expect(ok(native, dev('c', 'sonoff-zbdongle-p')).ok).toBe(false);
    expect(ok(zha, dev('h', 'aqara-hub-m2')).ok).toBe(false);
    expect(ok(native, dev('hb', 'hue-bridge-v2')).ok).toBe(false);
  });

  it('Thread con border router, Z-Wave con controlador, RF 433 con puente, BLE con proxy', () => {
    expect(ok(dev('l', 'aqara-u200'), dev('b', 'google-nest-hub-2'))).toEqual({ ok: true, protocol: 'thread' });
    expect(ok(dev('l', 'aqara-u200'), dev('b', 'ikea-dirigera'))).toEqual({ ok: true, protocol: 'thread' });
    expect(ok(dev('l', 'aqara-u200'), dev('b', 'aqara-hub-m2')).ok).toBe(false);
    expect(ok(dev('z', 'shelly-wave-1pm'), dev('c', 'ha-connect-zwa-2'))).toEqual({ ok: true, protocol: 'zwave' });
    expect(ok(dev('z', 'shelly-wave-1pm'), dev('c', 'sonoff-zbdongle-p')).ok).toBe(false);
    expect(ok(dev('r', 'sonoff-dw2-rf'), dev('b', 'sonoff-rf-bridge-r2'))).toEqual({ ok: true, protocol: 'rf433' });
    expect(ok(dev('r', 'sonoff-dw2-rf'), dev('b', 'hue-bridge-v2')).ok).toBe(false);
    expect(ok(dev('t', 'xiaomi-lywsd03mmc'), dev('s', 'shelly-plug-s-gen3'))).toEqual({ ok: true, protocol: 'ble' });
    expect(ok(dev('s', 'shelly-plug-s-gen3'), dev('t', 'xiaomi-lywsd03mmc'))).toEqual({ ok: true, protocol: 'ble' });
    expect(ok(dev('t', 'xiaomi-lywsd03mmc'), dev('ap', 'tplink-deco-x50')).ok).toBe(false);
  });

  it('Ethernet con router o servidor', () => {
    expect(ok(dev('c', 'reolink-rlc-810a'), dev('ap', 'tplink-deco-x50'))).toEqual({ ok: true, protocol: 'ethernet' });
    expect(ok(dev('c', 'reolink-rlc-810a'), dev('s', 'ha-green'))).toEqual({ ok: true, protocol: 'ethernet' });
    expect(ok(dev('c', 'reolink-rlc-810a'), dev('h', 'hue-bridge-v2')).ok).toBe(false);
  });

  it('entre dispositivos: malla solo con un router y misma red', () => {
    const router = dev('r', 'sonoff-s26r2zb');
    const sensor = dev('s', 'sonoff-snzb-03p');
    expect(ok(sensor, router)).toEqual({ ok: true, protocol: 'zigbee' });
    expect(ok(sensor, dev('s2', 'sonoff-snzb-04p')).ok).toBe(false);
    expect(ok(dev('h', 'hue-white-e27'), router).ok).toBe(false);
    expect(ok(dev('a', 'tapo-p110'), dev('b', 'tuya-wifi-plug')).ok).toBe(false);
    expect(ok(dev('a', 'tapo-p110'), dev('b', 'sonoff-snzb-03p')).ok).toBe(false);
    expect(ok(dev('a', 'ikea-grillplats'), dev('b', 'ikea-kajplats-e27'))).toEqual({ ok: true, protocol: 'thread' });
  });

  it('infraestructura: coordinador al servidor, hubs al router', () => {
    expect(ok(dev('c', 'sonoff-zbdongle-p'), dev('s', 'ha-green'))).toEqual({ ok: true, protocol: 'zigbee' });
    expect(ok(dev('c', 'sonoff-zbdongle-p'), dev('ap', 'tplink-deco-x50')).ok).toBe(false);
    expect(ok(dev('h', 'hue-bridge-v2'), dev('ap', 'tplink-deco-x50'))).toEqual({ ok: true, protocol: 'ethernet' });
    expect(ok(dev('e', 'amazon-echo-4'), dev('ap', 'tplink-deco-x50'))).toEqual({ ok: true, protocol: 'wifi' });
    expect(ok(dev('e', 'amazon-echo-4'), dev('n', 'google-nest-hub-2'))).toEqual({ ok: true, protocol: 'thread' });
    expect(ok(dev('e', 'amazon-echo-4'), dev('h', 'hue-bridge-v2')).ok).toBe(false);
  });

  it('casos inválidos', () => {
    const a = dev('a', 'tapo-p110');
    expect(ok(a, a).ok).toBe(false);
    expect(ok(a, { ...a, id: 'b', definitionId: 'nada' })).toEqual({ ok: false, reason: 'Definición de dispositivo desconocida' });
  });

  it('isWiredLink', () => {
    expect(isWiredLink(dev('c', 'sonoff-zbdongle-p'), dev('s', 'ha-green'), catalog, 'zigbee')).toBe(true);
    expect(isWiredLink(dev('a', 'tapo-p110'), dev('b', 'tplink-deco-x50'), catalog, 'wifi')).toBe(false);
    expect(isWiredLink(dev('a', 'tapo-p110'), dev('b', 'tplink-deco-x50'), catalog, 'ethernet')).toBe(true);
  });
});

describe('suggestConnections', () => {
  const base = () => [
    dev('srv', 'ha-green', { x: 0, y: 0 }),
    dev('ap', 'tplink-deco-x50', { x: 50, y: 0 }),
    dev('zc', 'sonoff-zbdongle-p', { x: 0, y: 50 }),
    dev('hue', 'hue-bridge-v2', { x: 100, y: 0 }),
  ];

  it('conecta infraestructura y dispositivos a su padre lógico', () => {
    const p = project([
      ...base(),
      dev('plug', 'tapo-p110', { x: 300, y: 0 }),
      dev('bulb', 'hue-white-e27', { x: 300, y: 300 }),
      dev('sensor', 'sonoff-snzb-03p', { x: 200, y: 200 }),
      dev('cam', 'reolink-rlc-810a', { x: 5000, y: 5000 }),
    ]);
    const links = suggestConnections(p, catalog).map((c) => `${c.sourceId}->${c.targetId}:${c.protocol}`);
    expect(links.sort()).toEqual(
      [
        'ap->srv:ethernet',
        'zc->srv:zigbee',
        'hue->ap:ethernet',
        'plug->ap:wifi',
        'bulb->hue:zigbee',
        'sensor->zc:zigbee',
        'cam->ap:ethernet',
      ].sort(),
    );
  });

  it('usa routers de la malla para llegar más lejos', () => {
    const p = project([
      ...base(),
      dev('r1', 'sonoff-s26r2zb', { x: 900, y: 50 }), // 18 m del coordinador
      dev('far', 'sonoff-snzb-03p', { x: 1700, y: 50 }), // 34 m del coordinador, 16 m del router
    ]);
    const links = suggestConnections(p, catalog);
    expect(links.find((c) => c.sourceId === 'r1')?.targetId).toBe('zc');
    expect(links.find((c) => c.sourceId === 'far')?.targetId).toBe('r1');
  });

  it('si nada está a alcance, conecta al compatible más cercano (el validador lo marcará)', () => {
    const p = project([...base(), dev('far', 'sonoff-snzb-03p', { x: 5000, y: 0 })]);
    expect(suggestConnections(p, catalog).find((c) => c.sourceId === 'far')?.targetId).toBe('zc');
  });

  it('no duplica dispositivos que ya tienen enlace de subida ni conecta incompatibles', () => {
    const p = project([...base(), dev('plug', 'tapo-p110', { x: 300, y: 0 }), dev('lock', 'aqara-u200')], {
      connections: [conn('c1', 'plug', 'ap', 'wifi')],
    });
    const links = suggestConnections(p, catalog);
    expect(links.some((c) => c.sourceId === 'plug')).toBe(false);
    expect(links.some((c) => c.sourceId === 'lock')).toBe(false);
    expect(new Set(links.map((c) => c.id)).size).toBe(links.length);
  });
});

describe('analyzeMesh', () => {
  it('BFS desde la infraestructura con saltos y routers', () => {
    const p = project([
      dev('zc', 'sonoff-zbdongle-p', { x: 0, y: 0 }),
      dev('r1', 'sonoff-s26r2zb', { x: 900, y: 0 }),
      dev('s1', 'sonoff-snzb-03p', { x: 1700, y: 0 }),
      dev('s2', 'sonoff-snzb-04p', { x: 5000, y: 0 }),
    ]);
    const mesh = analyzeMesh(p, catalog);
    expect(mesh.hops).toEqual({ zc: 0, r1: 1, s1: 2 });
    expect(mesh.unreachable).toEqual(['s2']);
    expect(mesh.reachable.has('s1')).toBe(true);
  });

  it('los dispositivos finales no repiten la señal', () => {
    const p = project([
      dev('zc', 'sonoff-zbdongle-p', { x: 0, y: 0 }),
      dev('end', 'sonoff-zbminil2', { x: 700, y: 0 }),
      dev('s1', 'sonoff-snzb-03p', { x: 1600, y: 0 }),
    ]);
    expect(analyzeMesh(p, catalog).unreachable).toEqual(['s1']);
  });

  it('los enlaces por cable exigen una conexión explícita', () => {
    const devices = [dev('ap', 'tplink-deco-x50'), dev('cam', 'reolink-rlc-810a', { x: 10, y: 0 })];
    expect(analyzeMesh(project(devices), catalog).unreachable).toEqual(['cam']);
    const wired = project(devices, { connections: [conn('c', 'cam', 'ap', 'ethernet')] });
    expect(analyzeMesh(wired, catalog).hops.cam).toBe(1);
  });

  it('los proxies BLE repiten solo hacia dispositivos BLE', () => {
    const p = project([
      dev('ap', 'tplink-deco-x50', { x: 0, y: 0 }),
      dev('proxy', 'shelly-plug-s-gen3', { x: 1000, y: 0 }),
      dev('ble', 'xiaomi-lywsd03mmc', { x: 1300, y: 0 }),
    ]);
    expect(analyzeMesh(p, catalog).hops).toEqual({ ap: 0, proxy: 1, ble: 2 });
  });

  it('sin infraestructura nada es alcanzable', () => {
    const p = project([dev('a', 'tapo-p110'), { ...dev('b', 'tapo-p110'), definitionId: 'nada' }]);
    expect(analyzeMesh(p, catalog).unreachable).toEqual(['a', 'b']);
  });
});
