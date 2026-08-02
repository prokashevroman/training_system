import clsx from "clsx";
import type { ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import { enumLabel } from "./labels.js";

/**
 * Form primitives for manual entry.
 *
 * Each takes the object `register()` returns, so the components stay unaware of
 * the form shape and every field is wired the same way.
 */

const CONTROL =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  className?: string;
}

export function Field({
  label,
  error,
  hint,
  className,
  children,
}: FieldProps & { children: ReactNode }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && (
        <span role="alert" className="mt-1 block text-xs text-rose-400">
          {error}
        </span>
      )}
    </label>
  );
}

export function TextField({
  registration,
  type = "text",
  placeholder,
  ...field
}: FieldProps & {
  registration: UseFormRegisterReturn;
  type?: "text" | "date";
  placeholder?: string;
}) {
  return (
    <Field {...field}>
      <input type={type} placeholder={placeholder} className={CONTROL} {...registration} />
    </Field>
  );
}

/**
 * Numbers use `type="text"` with a decimal keypad rather than `type="number"`.
 * A native number input discards anything it cannot parse — including the
 * decimal comma this corpus is written in (`97,5`) — and would turn a typo into
 * a silently empty field instead of a validation message.
 */
export function NumberField({
  registration,
  placeholder,
  ...field
}: FieldProps & { registration: UseFormRegisterReturn; placeholder?: string }) {
  return (
    <Field {...field}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        className={CONTROL}
        {...registration}
      />
    </Field>
  );
}

export function TextAreaField({
  registration,
  rows = 3,
  placeholder,
  ...field
}: FieldProps & {
  registration: UseFormRegisterReturn;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <Field {...field}>
      <textarea rows={rows} placeholder={placeholder} className={CONTROL} {...registration} />
    </Field>
  );
}

export function SelectField({
  registration,
  options,
  ...field
}: FieldProps & { registration: UseFormRegisterReturn; options: readonly string[] }) {
  return (
    <Field {...field}>
      <select className={CONTROL} {...registration}>
        {options.map((option) => (
          <option key={option} value={option}>
            {enumLabel(option)}
          </option>
        ))}
      </select>
    </Field>
  );
}
