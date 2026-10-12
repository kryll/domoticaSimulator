import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';
import { tabPanelId } from './ids';

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
}

export interface TabsProps<K extends string> {
  tabs: TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  label: string;
  className?: string;
  /** Prefijo para enlazar con los paneles (aria-controls). */
  idPrefix?: string;
}

export function Tabs<K extends string>({ tabs, active, onChange, label, className, idPrefix }: TabsProps<K>) {
  const autoId = useId();
  const prefix = idPrefix ?? autoId;
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else return;
    e.preventDefault();
    const tab = tabs[next];
    if (tab) {
      onChange(tab.key);
      refs.current[next]?.focus();
    }
  };

  return (
    <div role="tablist" aria-label={label} className={cx('flex gap-1', className)}>
      {tabs.map((tab, i) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${prefix}-tab-${tab.key}`}
            aria-selected={selected}
            aria-controls={tabPanelId(prefix, tab.key)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cx(
              'rounded-t-md border-b-2 px-3 py-1.5 text-sm font-medium',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
              selected
                ? 'border-sky-600 text-sky-700'
                : 'border-transparent text-slate-500 hover:text-slate-800',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
