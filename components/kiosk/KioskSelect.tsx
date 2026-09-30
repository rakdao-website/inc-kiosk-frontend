"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type KioskOption = { value: string; label: string; hint?: string };

type KioskSelectProps = {
  label?: string;
  value: string;
  options: KioskOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shown inside the open list when there are no options. */
  emptyMessage?: string;
  disabled?: boolean;
  /** "compact" = the country-code picker inside a phone field. */
  variant?: "field" | "compact";
  /** "up" opens the list above the field (for fields near the bottom). */
  placement?: "down" | "up";
};

/**
 * Dropdown drawn inside the kiosk frame. The browser's native <select>
 * list is drawn by the OS at the screen's real size, so on the scaled
 * 1080x1920 frame it came out huge and unstyled -- this one scales with
 * the rest of the design.
 */
export function KioskSelect({
  label,
  value,
  options,
  onChange,
  placeholder = "Select",
  emptyMessage = "No options available",
  disabled = false,
  variant = "field",
  placement = "down",
}: KioskSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = options.find((option) => option.value === value);

  // Close on a tap outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Bring the chosen option into view when the list opens.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>("[aria-selected='true']")?.scrollIntoView({ block: "nearest" });
  }, [open]);

  function choose(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div className={`kselect kselect-${variant}${open ? " open" : ""}`} ref={rootRef}>
      {label ? (
        <span className="field-label" id={`${id}-label`}>
          {label}
        </span>
      ) : null}
      <button
        aria-controls={`${id}-list`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={label ? `${id}-label ${id}-value` : undefined}
        className="kselect-trigger"
        disabled={disabled}
        onClick={() => setOpen((isOpen) => !isOpen)}
        type="button"
      >
        <span className={selected ? "kselect-value" : "kselect-value placeholder"} id={`${id}-value`}>
          {selected ? (variant === "compact" ? selected.value : selected.label) : placeholder}
        </span>
        <ChevronDown aria-hidden className="kselect-chevron" />
      </button>
      {open ? (
        <div className={placement === "up" ? "kselect-list up" : "kselect-list"} id={`${id}-list`} ref={listRef} role="listbox">
          {options.length === 0 ? <p className="kselect-empty">{emptyMessage}</p> : null}
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                aria-selected={isSelected}
                className={isSelected ? "kselect-option selected" : "kselect-option"}
                key={option.value}
                onClick={() => choose(option.value)}
                role="option"
                type="button"
              >
                <span>
                  {option.label}
                  {option.hint ? <small>{option.hint}</small> : null}
                </span>
                {isSelected ? <Check aria-hidden /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}