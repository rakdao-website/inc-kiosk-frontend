import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";

type ServiceCardProps = {
  title: string;
  detail: string;
  icon: LucideIcon;
  onSelect: () => void;
};

export function ServiceCard({ title, detail, icon: Icon, onSelect }: ServiceCardProps) {
  return (
    <button
      className="group grid min-h-44 content-between rounded-md border border-white/14 bg-white/8 p-5 text-left transition hover:-translate-y-0.5 hover:border-cyan/70 hover:bg-white/12"
      onClick={onSelect}
      type="button"
    >
      <span className="flex items-start justify-between gap-4">
        <span className="grid h-11 w-11 place-items-center rounded-md bg-cyan/14 text-cyan">
          <Icon className="h-5 w-5" />
        </span>
        <ArrowRight className="h-5 w-5 text-white/40 transition group-hover:text-cyan" />
      </span>
      <span>
        <span className="block text-xl font-semibold text-white">{title}</span>
        <span className="mt-2 block text-sm leading-6 text-white/62">{detail}</span>
      </span>
    </button>
  );
}
