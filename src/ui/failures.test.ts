import { NO_FAILURES, failureLabels, hasFailures } from './failures';

describe('failures (interfaz)', () => {
  it('hasFailures acepta undefined', () => {
    expect(hasFailures(undefined)).toBe(false);
    expect(hasFailures(NO_FAILURES)).toBe(false);
    expect(hasFailures({ ...NO_FAILURES, devicesDown: ['x'] })).toBe(true);
  });

  it('failureLabels en español y con el nombre de los equipos caídos', () => {
    const labels = failureLabels({ internet: true, powerOutage: true, haRestarting: true, devicesDown: ['c'] }, (id) => (id === 'c' ? 'Coordinador' : id));
    expect(labels).toEqual(['Sin Internet', 'Corte de luz', 'Home Assistant reiniciando', 'Coordinador caído']);
    expect(failureLabels(undefined, (id) => id)).toEqual([]);
  });
});
