import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useSimulationStore } from '../store/simulationStore';
import { inputClass } from '../ui/Field';
import { cx } from '../ui/cx';
import { entityGroups, searchGroups, type EntityOption } from '../ui/entityOptions';

export interface EntityPickerProps {
  label: string;
  value: string;
  onChange: (entityId: string) => void;
  /** Limita a ciertos dominios (light, sensor...). */
  domains?: readonly string[];
  /** Limita a ciertas device_class (motion, door, temperature...). */
  deviceClasses?: readonly string[];
  /** Solo sensores con estado numérico (para disparadores y condiciones numéricas). */
  numericOnly?: boolean;
  /** Lista cerrada de entity_id admitidos. */
  allowedIds?: readonly string[];
  hint?: string;
}

/**
 * Selector de entidades accesible (patrón combobox de ARIA): búsqueda, agrupado por planta y
 * sala, «Dispositivo · Entidad» con icono y estado actual.
 */
export function EntityPicker({ label, value, onChange, domains, deviceClasses, numericOnly, allowedIds, hint }: EntityPickerProps) {
  const project = useProjectStore((s) => s.project);
  const states = useSimulationStore((s) => s.sim.entities);
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(
    () => entityGroups(project, states, { domains, deviceClasses, numericOnly, allowedIds }),
    // domains/deviceClasses suelen ser literales: se comparan por contenido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, states, domains?.join(), deviceClasses?.join(), numericOnly, allowedIds?.join()],
  );
  const filtered = useMemo(() => searchGroups(groups, query), [groups, query]);
  const flat = useMemo(() => filtered.flatMap((g) => g.options), [filtered]);
  const selected = useMemo(() => groups.flatMap((g) => g.options).find((o) => o.entityId === value), [groups, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  });

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const choose = (opt: EntityOption | undefined) => {
    if (!opt) return;
    onChange(opt.entityId);
    close();
  };
  const openList = () => {
    setOpen(true);
    const idx = flat.findIndex((o) => o.entityId === value);
    setActive(idx >= 0 ? idx : 0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openList();
        else setActive((i) => Math.min(flat.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openList();
        else setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        if (open) {
          e.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (open) {
          e.preventDefault();
          setActive(Math.max(0, flat.length - 1));
        }
        break;
      case 'Enter':
        if (open) {
          e.preventDefault();
          choose(flat[active]);
        }
        break;
      case 'Escape':
        if (open) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        break;
      case 'Tab':
        if (open) close();
        break;
    }
  };

  const activeOption = open ? flat[active] : undefined;
  const optionId = (o: EntityOption) => `${baseId}-opt-${o.entityId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const display = open ? query : selected ? selected.label : value ? `${value} (no existe)` : '';
  let index = -1;

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1">
      <label htmlFor={inputId} className="text-xs font-medium text-slate-600">
        {label}
      </label>
      <div className="relative">
        {!open && selected && (
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm" aria-hidden="true">
            {selected.icon}
          </span>
        )}
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
          aria-invalid={value !== '' && !selected ? true : undefined}
          autoComplete="off"
          spellCheck={false}
          className={cx(inputClass, 'pr-14', !open && selected && 'pl-7', value && !selected && 'text-red-700')}
          placeholder={open ? 'Buscar entidad…' : '— Elige una entidad —'}
          title={value || undefined}
          value={display}
          onFocus={() => {
            if (!open) openList();
          }}
          onClick={() => {
            if (!open) openList();
          }}
          onChange={(e) => {
            if (!open) setOpen(true);
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        {!open && selected && (
          <span className="pointer-events-none absolute right-6 top-1/2 max-w-[40%] -translate-y-1/2 truncate text-[11px] text-slate-500">
            {selected.stateText}
          </span>
        )}
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? `Cerrar lista de ${label}` : `Abrir lista de ${label}`}
          className="absolute right-1 top-1/2 -translate-y-1/2 px-1 text-xs text-slate-500"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (open ? close() : openList())}
        >
          ▾
        </button>
      </div>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={`Opciones: ${label}`}
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 min-w-[16rem] overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {flat.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-xs text-slate-500">
              Sin resultados
            </li>
          )}
          {filtered.map((g) => (
            <li key={g.label} role="presentation">
              <ul role="group" aria-label={g.label}>
                <li role="presentation" className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {g.label}
                </li>
                {g.options.map((o) => {
                  index++;
                  const i = index;
                  const isActive = i === active;
                  return (
                    <li
                      key={o.entityId}
                      id={optionId(o)}
                      role="option"
                      aria-selected={o.entityId === value}
                      data-index={i}
                      title={o.entityId}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(o)}
                      className={cx(
                        'flex cursor-pointer items-center gap-2 px-3 py-1',
                        isActive ? 'bg-sky-100 text-sky-900' : 'text-slate-700',
                        o.entityId === value && 'font-semibold',
                      )}
                    >
                      <span aria-hidden="true">{o.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      <span className="shrink-0 text-[11px] text-slate-500">{o.stateText}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
