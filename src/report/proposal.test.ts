import { describe, expect, it } from 'vitest';
import { catalog } from '../devices/catalog';
import type { Project } from '../types';
import { createDemoProject } from '../store/demoProject';
import { buildProposalHtml, buildQuote, escapeHtml, presentationSnapshot, pricesHidden, sanitizeSvg } from './proposal';

const AT = Date.UTC(2026, 9, 12, 10, 0, 0);

function withQuote(p: Project, quote: NonNullable<NonNullable<Project['settings']>['quote']>): Project {
  return { ...p, settings: { ...(p.settings ?? { latitude: 40, longitude: -3, electricityPriceEurKwh: 0.15 }), quote } };
}

describe('propuesta imprimible', () => {
  const demo = withQuote(createDemoProject(), { clientName: 'Familia García', clientAddress: 'Calle Mayor 1, Madrid', installerName: 'Instalaciones Sol', notes: 'Incluye una visita de revisión.' });
  const html = buildProposalHtml(demo, catalog, { generatedAt: AT, planSvg: '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>' });

  it('es un HTML autocontenido A4 con todas las secciones', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('@page { size: A4');
    expect(html).toContain('break-before: page');
    expect(html).not.toMatch(/<link|<script|src="http/);
    for (const title of ['Propuesta de instalación domótica', 'Resumen', 'Plano', 'Dispositivos por sala', 'Presupuesto', 'Qué pasa si falla algo', 'Automatizaciones', 'Guía de emparejamiento']) {
      expect(html).toContain(title);
    }
    expect(html).toContain('Familia García');
    expect(html).toContain('Instalaciones Sol');
    expect(html).toContain('12 de octubre de 2026');
    expect(html).toContain('<rect width="10" height="10"/>');
    expect(html).toContain('Se cae Internet');
    expect(html).toContain('Corte de luz');
    expect(html).toContain('Cuando se detecta movimiento en el pasillo');
    expect(html).toContain('Incluye una visita de revisión.');
  });

  it('el total del presupuesto aparece con formato español', () => {
    const q = buildQuote(demo, catalog);
    const total = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(q.total);
    expect(html).toContain(escapeHtml(total));
    expect(html).toContain('IVA (21 %)');
  });

  it('escapa todo el texto del usuario', () => {
    const evil = '<script>alert(1)</script>';
    const base = createDemoProject();
    const p = withQuote(
      {
        ...base,
        name: evil,
        devices: base.devices.map((d, i) => (i === 0 ? { ...d, name: evil } : d)),
        rooms: base.rooms.map((r, i) => (i === 0 ? { ...r, name: `${evil}"'&` } : r)),
        automations: base.automations.map((a, i) => (i === 0 ? { ...a, name: evil } : a)),
      },
      { clientName: evil, notes: evil, installerName: '<img src=x onerror=alert(1)>' },
    );
    const out = buildProposalHtml(p, catalog, { generatedAt: AT, planSvg: `<svg><script>alert(2)</script><g onclick="alert(3)"><a href="javascript:alert(4)"><text>Plano</text></a></g></svg>` });
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).not.toMatch(/onclick|javascript:/);
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&quot;&#39;&amp;');
    expect(out).toContain('<text>Plano</text>');
  });

  it('sanitizeSvg descarta lo que no es SVG', () => {
    expect(sanitizeSvg('<div>hola</div>')).toBe('');
    expect(sanitizeSvg('<?xml version="1.0"?><svg width="1"></svg>')).toBe('<svg width="1"></svg>');
  });

  it('con hidePrices no muestra importes', () => {
    const hidden = withQuote(createDemoProject(), { hidePrices: true, clientName: 'Ana' });
    const out = buildProposalHtml(hidden, catalog, { generatedAt: AT });
    expect(out).not.toContain('€');
    expect(out).not.toContain('Plano'.concat('</h2>'));
    expect(out).toContain('Ana');
  });
});

describe('modo presentación', () => {
  it('copia congelada, sin variantes y sin precios si hidePrices', () => {
    const base = createDemoProject();
    const p = withQuote({ ...base, settings: { ...base.settings!, prices: { 'ha-green': 99 } } }, { hidePrices: true, laborRateEurH: 50, marginPct: 20, clientName: 'Ana' });
    const snap = presentationSnapshot(p);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.devices[0])).toBe(true);
    expect(snap.settings?.prices).toBeUndefined();
    expect(snap.settings?.quote).toEqual({ hidePrices: true, clientName: 'Ana' });
    expect(pricesHidden(snap)).toBe(true);
    expect(p.settings?.prices).toEqual({ 'ha-green': 99 });
    expect(() => {
      (snap.devices as unknown as unknown[]).push(1);
    }).toThrow();
  });

  it('sin hidePrices conserva los precios', () => {
    const base = createDemoProject();
    const p = { ...base, settings: { ...base.settings!, prices: { 'ha-green': 99 } } };
    expect(presentationSnapshot(p).settings?.prices).toEqual({ 'ha-green': 99 });
  });
});
