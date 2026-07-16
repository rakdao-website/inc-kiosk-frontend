import { X } from "lucide-react";
import { KioskButton } from "./KioskButton";

type VoiceAssistButtonProps = {
  open: boolean;
  onClose: () => void;
};

export function VoiceAssistModal({ open, onClose }: VoiceAssistButtonProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-6">
      <div className="w-full max-w-md rounded-md border border-cyan/30 bg-panel p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan">
              Voice assistance
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Voice assistance is starting...</h2>
          </div>
          <button
            aria-label="Close voice assistance"
            className="grid h-10 w-10 place-items-center rounded-md border border-white/15 bg-white/8"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-4 text-white/68">
          This kiosk is ready for the voice flow when the assistance service is connected.
        </p>
        <KioskButton className="mt-6 w-full" onClick={onClose} variant="secondary">
          Continue
        </KioskButton>
      </div>
    </div>
  );
}
