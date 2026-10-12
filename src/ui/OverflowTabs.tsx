import { useLayoutEffect, useRef, useState } from 'react';
import { Tabs, type TabItem } from './Tabs';
import { Dropdown } from './Dropdown';

export interface OverflowTabsProps<K extends string> {
  tabs: Array<TabItem<K> & { text: string }>;
  active: K;
  onChange: (key: K) => void;
  label: string;
  idPrefix?: string;
}

/** Ancho reservado para el botón «Más ▾» (px). */
const MORE_PX = 72;

/**
 * Pestañas que nunca se cortan ni piden scroll: mide el espacio con ResizeObserver y lleva las
 * que no caben a un menú «Más ▾». La pestaña activa siempre queda visible.
 */
export function OverflowTabs<K extends string>({ tabs, active, onChange, label, idPrefix }: OverflowTabsProps<K>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(tabs.length);
  const keys = tabs.map((t) => t.key).join('|');

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure) return;
    const compute = () => {
      const widths = [...measure.children].map((el) => (el as HTMLElement).offsetWidth);
      const available = wrap.clientWidth;
      // Sin medidas (jsdom) o si caben todas, se muestran todas.
      const total = widths.reduce((a, b) => a + b + 4, 0);
      if (available === 0 || total <= available) {
        setFit(tabs.length);
        return;
      }
      let used = MORE_PX;
      let n = 0;
      for (const w of widths) {
        if (used + w + 4 > available) break;
        used += w + 4;
        n++;
      }
      setFit(Math.max(1, n));
    };
    compute();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [keys, tabs.length]);

  let visible = tabs.slice(0, fit);
  const activeIndex = tabs.findIndex((t) => t.key === active);
  if (activeIndex >= fit && fit > 0) {
    const activeTab = tabs[activeIndex];
    if (activeTab) visible = [...tabs.slice(0, fit - 1), activeTab];
  }
  const hidden = tabs.filter((t) => !visible.includes(t));

  return (
    <div ref={wrapRef} className="relative flex min-w-0 flex-1 items-center gap-1">
      {/* Copia invisible para medir el ancho natural de cada pestaña. */}
      <div ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 flex gap-1 whitespace-nowrap">
        {tabs.map((t) => (
          <span key={t.key} className="rounded-t-md border-b-2 px-3 py-1.5 text-sm font-medium">
            {t.label}
          </span>
        ))}
      </div>
      <Tabs<K> label={label} tabs={visible} active={active} onChange={onChange} idPrefix={idPrefix} className="min-w-0 whitespace-nowrap" />
      {hidden.length > 0 && (
        <Dropdown
          label="Más"
          ariaLabel="Más pestañas"
          align="right"
          entries={hidden.map((t) => ({ kind: 'item' as const, id: t.key, label: t.text, onSelect: () => onChange(t.key) }))}
        />
      )}
    </div>
  );
}
