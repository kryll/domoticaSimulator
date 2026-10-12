import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

export const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-800 ' +
  'focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-50';

export interface FieldProps {
  label: string;
  children: (id: string) => ReactNode;
  hint?: ReactNode;
  className?: string;
  hideLabel?: boolean;
}

/** Envuelve un control con su etiqueta accesible. */
export function Field({ label, children, hint, className, hideLabel }: FieldProps) {
  const id = useId();
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className={cx('text-xs font-medium text-slate-600', hideLabel && 'sr-only')}>
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  hideLabel?: boolean;
  fieldClassName?: string;
}

export function TextField({ label, hint, hideLabel, fieldClassName, className, ...rest }: TextFieldProps) {
  return (
    <Field label={label} hint={hint} hideLabel={hideLabel} className={fieldClassName}>
      {(id) => <input id={id} className={cx(inputClass, className)} {...rest} />}
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  options: SelectOption[];
  hint?: ReactNode;
  hideLabel?: boolean;
  placeholder?: string;
  fieldClassName?: string;
}

export function SelectField({
  label,
  options,
  hint,
  hideLabel,
  placeholder,
  fieldClassName,
  className,
  ...rest
}: SelectFieldProps) {
  return (
    <Field label={label} hint={hint} hideLabel={hideLabel} className={fieldClassName}>
      {(id) => (
        <select id={id} className={cx(inputClass, className)} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: ReactNode;
  hideLabel?: boolean;
}

export function TextAreaField({ label, hint, hideLabel, className, ...rest }: TextAreaFieldProps) {
  return (
    <Field label={label} hint={hint} hideLabel={hideLabel}>
      {(id) => <textarea id={id} className={cx(inputClass, 'font-mono text-xs', className)} {...rest} />}
    </Field>
  );
}
