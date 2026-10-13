import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import { isInternetNode, isOperatorEquipment, isOperatorRouter, OPERATOR_BRANDS } from '../devices/roles';
import { def, dev, project } from '../devices/testUtils';
import type { Connection, Device, Failures, Project } from '../types';
import { NO_FAILURES } from '../simulation/connectivity';
import { failureImpact, scenarioFailures } from '../simulation/scenarios';
import { computeUnavailable, internetAvailable, unavailabilityReasons } from '../simulation/availability';
import { canConnect, explainUnconnected, suggestConnections } from './connections';
import { cloudLossReason, downUplinkDevices, failuresMayCutInternet, hasInternetNode, internetLoss, internetPathExists } from './internet';
import { validateProject } from './validator';

const f = (patch: Partial<Failures>): Failures => ({ ...NO_FAILURES, ...patch });

const link = (sourceId: string, targetId: string, protocol: Connection['protocol'] = 'ethernet'): Connection => ({ id: `${sourceId}-${targetId}`, sourceId, targetId, protocol });

/** Casa con fibra: salida → router Movistar → HA; Deco colgado del router; enchufe eWeLink (nube) en el Deco. */
function home(extra: Device[] = [], connections?: Connection[]): Project {
  const devices = [
    dev('srv', 'ha-green', { x: 0, y: 0 }),
    dev('isp', 'movistar-smart-wifi-6', { x: 50, y: 0 }),
    dev('net', 'internet-fibra', { x: 100, y: 0 }),
    dev('deco', 'tplink-deco-x50', { x: 150, y: 0 }),
    dev('plug', 'sonoff-s26r2', { x: 200, y: 0 }),
    ...extra,
  ];
  return project(devices, {
    connections: connections ?? [link('net', 'isp'), link('isp', 'srv'), link('deco', 'isp'), link('plug', 'deco', 'wifi')],
  });
}

describe('salida a Internet: catálogo', () => {
  it('la salida a Internet y los routers de operadora son equipos incluidos con la fibra (0 €)', () => {
    expect(isInternetNode(def('internet-fibra'))).toBe(true);
    expect(def('internet-fibra').entities).toEqual([]);
    for (const id of ['movistar-smart-wifi-6', 'movistar-smart-wifi-7', 'vodafone-wifi-6-station', 'vodafone-h500s', 'orange-livebox-6', 'orange-livebox-7', 'digi-zte-f6640', 'digi-zte-f8648p']) {
      const d = def(id);
      expect(isOperatorRouter(d), id).toBe(true);
      expect(d.role, id).toBe('access_point');
      expect(d.protocols, id).toEqual(expect.arrayContaining(['wifi', 'ethernet']));
      expect(d.priceEur, id).toBe(0);
      expect(d.entities, id).toEqual([]);
      expect(d.integrations, id).toContain('upnp');
      expect(OPERATOR_BRANDS).toContain(d.brand);
    }
    expect(def('orange-livebox-6').integrations).toContain('livebox');
    // El Deco no es de una operadora: se compra aparte.
    expect(isOperatorEquipment(def('tplink-deco-x50'))).toBe(false);
  });

  it('la salida solo se conecta a un router, por cable', () => {
    const p = home();
    const [srv, isp, net, deco, plug] = p.devices as [Device, Device, Device, Device, Device];
    expect(canConnect(net, isp, catalog)).toEqual({ ok: true, protocol: 'ethernet' });
    expect(canConnect(net, deco, catalog)).toEqual({ ok: true, protocol: 'ethernet' });
    expect(canConnect(net, srv, catalog).ok).toBe(false);
    expect(canConnect(net, plug, catalog).ok).toBe(false);
    expect(canConnect(net, dev('zc', 'sonoff-zbdongle-p'), catalog).ok).toBe(false);
    expect(canConnect(net, dev('net2', 'internet-fibra'), catalog).ok).toBe(false);
  });

  it('Autoconectar cuelga la salida y el Deco del router de la operadora, y el router del servidor', () => {
    const p = home([], []);
    const links = suggestConnections(p, catalog).map((c) => `${c.sourceId}>${c.targetId}`);
    expect(links).toEqual(expect.arrayContaining(['net>isp', 'deco>isp', 'isp>srv']));
  });

  it('sin router de operadora el Deco sigue colgando del servidor (proyectos de siempre)', () => {
    const p = project([dev('srv', 'ha-green'), dev('deco', 'tplink-deco-x50', { x: 50, y: 0 })]);
    expect(suggestConnections(p, catalog).map((c) => `${c.sourceId}>${c.targetId}`)).toEqual(['deco>srv']);
  });

  it('explica que la salida necesita un router', () => {
    const p = project([dev('srv', 'ha-green'), dev('net', 'internet-fibra')]);
    expect(explainUnconnected(p, catalog).map((r) => r.reason)).toEqual([expect.stringMatching(/router de la operadora/)]);
  });
});

describe('salida a Internet: camino desde Home Assistant', () => {
  it('hay camino por las conexiones dibujadas y se corta si cae el router', () => {
    const p = home();
    expect(hasInternetNode(p, catalog)).toBe(true);
    expect(internetPathExists(p, catalog)).toBe(true);
    expect(internetPathExists(p, catalog, new Set(['isp']))).toBe(false);
    expect(internetPathExists(p, catalog, new Set(['net']))).toBe(false);
    // El Deco no está en el camino (cuelga del router).
    expect(internetPathExists(p, catalog, new Set(['deco']))).toBe(true);
  });

  it('el camino puede pasar por varios routers', () => {
    const p = home([], [link('net', 'isp'), link('deco', 'isp'), link('deco', 'srv')]);
    expect(internetPathExists(p, catalog)).toBe(true);
    expect(internetPathExists(p, catalog, new Set(['deco']))).toBe(false);
  });

  it('sin conexiones dibujadas usa los enlaces compatibles', () => {
    expect(internetPathExists(home([], []), catalog)).toBe(true);
  });

  it('el tráfico no pasa por un dispositivo final ni por la salida sin router', () => {
    const p = project([dev('srv', 'ha-green'), dev('net', 'internet-fibra')], { connections: [link('net', 'srv')] });
    expect(internetPathExists(p, catalog)).toBe(false);
  });

  it('sin servidor de HA basta con que un router llegue a la salida', () => {
    const p = project([dev('isp', 'orange-livebox-6'), dev('net', 'internet-fibra')], { connections: [link('net', 'isp')] });
    expect(internetPathExists(p, catalog)).toBe(true);
    expect(internetPathExists(p, catalog, new Set(['isp']))).toBe(false);
  });

  it('caen el router sin SAI con el corte de luz, pero no la salida (red de la operadora)', () => {
    const p = home();
    expect([...downUplinkDevices(p, catalog, f({ powerOutage: true }))].sort()).toEqual(['deco', 'isp']);
    const withUps = { ...p, devices: p.devices.map((d) => (d.id === 'isp' ? { ...d, ups: true } : d)) };
    expect([...downUplinkDevices(withUps, catalog, f({ powerOutage: true }))]).toEqual(['deco']);
    expect([...downUplinkDevices(p, catalog, f({ devicesDown: ['net', 'plug'] }))]).toEqual(['net']);
  });
});

describe('salida a Internet: disponibilidad', () => {
  it('con salida a Internet: sin fallos hay Internet', () => {
    expect(internetLoss(home(), catalog, NO_FAILURES)).toBeNull();
    expect(internetAvailable(home(), catalog, NO_FAILURES)).toBe(true);
  });

  it('«Internet cae», el router caído y la salida caída tienen el mismo efecto en la nube', () => {
    const p = home();
    const cut = computeUnavailable(p, catalog, f({ internet: true }));
    expect(cut.has('plug')).toBe(true);
    expect(internetLoss(p, catalog, f({ internet: true }))).toBe('cut');

    const net = unavailabilityReasons(p, catalog, f({ devicesDown: ['net'] }));
    expect(internetLoss(p, catalog, f({ devicesDown: ['net'] }))).toBe('path');
    expect(net.get('plug')).toBe(cloudLossReason('path'));
    expect(internetAvailable(p, catalog, f({ devicesDown: ['net'] }))).toBe(false);

    const isp = unavailabilityReasons(p, catalog, f({ devicesDown: ['isp'] }));
    expect(internetAvailable(p, catalog, f({ devicesDown: ['isp'] }))).toBe(false);
    expect(isp.has('plug')).toBe(true);
  });

  it('un Deco caído fuera del camino no corta Internet (solo cae lo que cuelga de él)', () => {
    const p = home([dev('tv', 'samsung-qled-q80', { x: 60, y: 0 })], [link('net', 'isp'), link('isp', 'srv'), link('deco', 'isp'), link('plug', 'deco', 'wifi'), link('tv', 'isp', 'wifi')]);
    expect(internetAvailable(p, catalog, f({ devicesDown: ['deco'] }))).toBe(true);
    const reasons = unavailabilityReasons(p, catalog, f({ devicesDown: ['deco'] }));
    expect(reasons.get('plug')).toMatch(/depende de «deco»/);
    expect(reasons.has('tv')).toBe(false);
  });

  it('corte de luz: sin SAI en el router no hay Internet; con SAI en el router sí', () => {
    const p = home();
    expect(internetLoss(p, catalog, f({ powerOutage: true }))).toBe('path');
    const ups = { ...p, devices: p.devices.map((d) => (d.id === 'isp' || d.id === 'srv' ? { ...d, ups: true } : d)) };
    expect(internetAvailable(ups, catalog, f({ powerOutage: true }))).toBe(true);
  });

  it('sin salida a Internet se mantiene el modelo de siempre (compatibilidad)', () => {
    const old = project([dev('srv', 'ha-green'), dev('ap', 'tplink-deco-x50'), dev('plug', 'sonoff-s26r2')]);
    expect(internetAvailable(old, catalog, NO_FAILURES)).toBe(true);
    expect(internetAvailable(old, catalog, f({ internet: true }))).toBe(false);
    expect(internetLoss(old, catalog, f({ powerOutage: true }))).toBe('power');
    // Que caiga el router no cortaba Internet antes (la nube se pierde por el camino, no por Internet).
    expect(internetAvailable(old, catalog, f({ devicesDown: ['ap'] }))).toBe(true);
    const ups = { ...old, devices: old.devices.map((d) => (d.id === 'ap' ? { ...d, ups: true } : d)) };
    expect(internetAvailable(ups, catalog, f({ powerOutage: true }))).toBe(true);
  });

  it('con salida pero sin camino de diseño no se deja la casa sin Internet (lo avisa el validador)', () => {
    const isolated = project([dev('srv', 'ha-green'), dev('net', 'internet-fibra'), dev('plug', 'sonoff-s26r2')], { connections: [] });
    expect(internetPathExists(isolated, catalog)).toBe(false);
    expect(internetLoss(isolated, catalog, NO_FAILURES)).toBeNull();
    expect(internetLoss(isolated, catalog, f({ devicesDown: ['net'] }))).toBeNull();
  });

  it('failuresMayCutInternet: solo con algún fallo que pueda cortar', () => {
    expect(failuresMayCutInternet(NO_FAILURES)).toBe(false);
    expect(failuresMayCutInternet(f({ haRestarting: true }))).toBe(false);
    expect(failuresMayCutInternet(f({ devicesDown: ['x'] }))).toBe(true);
    expect(failuresMayCutInternet(f({ powerOutage: true }))).toBe(true);
  });

  it('el informe de impacto da la voz en la nube por perdida si cae la salida', () => {
    const p = home([dev('echo', 'amazon-echo-dot-5', { x: 60, y: 60 })], [link('net', 'isp'), link('isp', 'srv'), link('echo', 'isp', 'wifi')]);
    const down = failureImpact(p, catalog, f({ devicesDown: ['net'] }));
    expect(down.voice.find((v) => v.deviceId === 'echo')?.status).toBe('broken');
    const internet = failureImpact(p, catalog, scenarioFailures('internet', p, catalog));
    expect(internet.voice.find((v) => v.deviceId === 'echo')?.status).toBe('broken');
    expect(failureImpact(p, catalog, NO_FAILURES).voice.find((v) => v.deviceId === 'echo')?.status).toBe('ok');
  });
});

describe('salida a Internet: validador', () => {
  const internetCodes = (p: Project): string[] => validateProject(p, catalog).map((i) => i.code).filter((c) => c === 'sin-camino-internet' || c === 'sin-salida-internet');

  it('casa con fibra bien conectada: sin avisos', () => {
    expect(internetCodes(home())).toEqual([]);
  });

  it('salida sin camino hasta HA con dispositivos en la nube', () => {
    const p = project([dev('srv', 'ha-green'), dev('isp', 'movistar-smart-wifi-6'), dev('net', 'internet-fibra'), dev('plug', 'sonoff-s26r2')], {
      connections: [link('isp', 'srv'), link('plug', 'isp', 'wifi'), link('net', 'isp')],
    });
    expect(internetCodes(p)).toEqual([]);
    const cut = { ...p, devices: [...p.devices, dev('isp2', 'digi-zte-f6640')], connections: [link('isp', 'srv'), link('plug', 'isp', 'wifi'), link('net', 'isp2')] };
    const issue = validateProject(cut, catalog).find((i) => i.code === 'sin-camino-internet');
    expect(issue).toMatchObject({ severity: 'warning' });
    expect(issue?.deviceIds).toEqual(expect.arrayContaining(['net', 'plug']));
    expect(issue?.message).toMatch(/no llega a Home Assistant/);
  });

  it('router de operadora sin salida a Internet y con nube: avisa; sin nube, no', () => {
    const p = project([dev('srv', 'ha-green'), dev('isp', 'orange-livebox-7'), dev('plug', 'sonoff-s26r2')], { connections: [link('isp', 'srv'), link('plug', 'isp', 'wifi')] });
    expect(internetCodes(p)).toEqual(['sin-salida-internet']);
    const local = { ...p, devices: p.devices.filter((d) => d.id !== 'plug'), connections: [link('isp', 'srv')] };
    expect(internetCodes(local)).toEqual([]);
  });

  it('proyectos de siempre (Deco sin salida a Internet): ningún aviso nuevo', () => {
    const p = project([dev('srv', 'ha-green'), dev('ap', 'tplink-deco-x50'), dev('plug', 'sonoff-s26r2'), dev('echo', 'amazon-echo-dot-5')]);
    const withLinks = { ...p, connections: suggestConnections(p, catalog) };
    expect(internetCodes(withLinks)).toEqual([]);
  });

  it('la salida a Internet no da error de cobertura ni de conexión', () => {
    const codes = validateProject(home(), catalog).map((i) => i.code);
    expect(codes).not.toContain('fuera-de-cobertura');
    expect(codes).not.toContain('conexion-protocolo-incompatible');
    expect(codes).not.toContain('infraestructura-sin-conexion');
  });
});
