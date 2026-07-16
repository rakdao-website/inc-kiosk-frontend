import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import { twMerge } from "tailwind-merge";

type KioskButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  variant?: "primary" | "secondary" | "ghost";
};

export function KioskButton({
  children,
  className,
  icon: Icon = ArrowRight,
  variant = "primary",
  ...props
}: KioskButtonProps) {
  const variants = {
    primary: "bg-cyan text-ink shadow-[0_0_28px_rgba(66,220,229,0.22)] hover:bg-mint",
    secondary: "border border-white/20 bg-white/8 text-white hover:border-cyan/70 hover:bg-white/12",
    ghost: "bg-transparent text-cyan hover:bg-cyan/10",
  };

  return (
    <button
      className={twMerge(
        "inline-flex min-h-14 items-center justify-center gap-3 rounded-md px-6 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    >
      <span>{children}</span>
      <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
    </button>
  );
}
