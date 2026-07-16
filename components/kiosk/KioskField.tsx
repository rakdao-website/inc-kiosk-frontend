import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
};

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  options: Array<{ label: string; value: string }>;
};

export function KioskField({ label, ...props }: FieldProps) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-white/80">
      <span>{label}</span>
      <input
        className="min-h-14 rounded-md border border-white/16 bg-white/8 px-4 text-base text-white outline-none transition placeholder:text-white/35 focus:border-cyan"
        {...props}
      />
    </label>
  );
}

export function KioskSelect({ label, options, ...props }: SelectProps) {
  return (
    <label className="grid gap-2 text-sm font-semibold text-white/80">
      <span>{label}</span>
      <select
        className="min-h-14 rounded-md border border-white/16 bg-white/8 px-4 text-base text-white outline-none transition focus:border-cyan"
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} className="bg-ink text-white" value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
