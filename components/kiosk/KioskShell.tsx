import Image from "next/image";
import type { ReactNode } from "react";
import { Home, Volume2 } from "lucide-react";

type KioskShellProps = {
  children: ReactNode;
  title: string;
  eyebrow?: string;
  onHome: () => void;
  onVoice: () => void;
};

export function KioskShell({
  children,
  title,
  eyebrow = "Innovation City",
  onHome,
  onVoice,
}: KioskShellProps) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-ink text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(66,220,229,0.16),transparent_28%),linear-gradient(135deg,rgba(255,207,112,0.12),transparent_26%),linear-gradient(180deg,#071417,#0c1c22_52%,#071417)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-7 py-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 place-items-center rounded-md bg-white p-2">
              <Image
                alt="Innovation City"
                height={52}
                src="/inc-live-dashboard.svg"
                width={52}
                priority
              />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan">
                {eyebrow}
              </p>
              <h1 className="mt-1 text-3xl font-semibold">{title}</h1>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              aria-label="Home"
              className="grid h-12 w-12 place-items-center rounded-md border border-white/15 bg-white/8 text-white transition hover:border-cyan"
              onClick={onHome}
              title="Home"
              type="button"
            >
              <Home className="h-5 w-5" />
            </button>
            <button
              aria-label="Voice assistance"
              className="grid h-12 w-12 place-items-center rounded-md border border-white/15 bg-white/8 text-white transition hover:border-cyan"
              onClick={onVoice}
              title="Voice assistance"
              type="button"
            >
              <Volume2 className="h-5 w-5" />
            </button>
          </div>
        </header>
        <section className="grid flex-1 items-center py-10">{children}</section>
      </div>
    </main>
  );
}
