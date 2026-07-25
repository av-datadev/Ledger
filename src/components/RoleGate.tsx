import type { AppMode } from "../hooks/useAppMode";

/**
 * Shown once, only to a genuinely fresh device (see useAppMode). Decides
 * whether this device opens into the private ledger or the contractor path.
 */
export function RoleGate({ onChoose }: { onChoose: (m: AppMode) => void }) {
  return (
    <div className="min-h-dvh bg-paper text-ink flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="text-lg font-semibold tracking-[0.18em]">
            BRICK FLOW
          </div>
          <div className="text-[13px] text-ink-soft mt-2">
            Are you building or renovating a home, or are you a contractor?
          </div>
        </div>
        <div className="space-y-3">
          <button
            className="btn btn-primary w-full !py-3.5 !text-base"
            onClick={() => onChoose("builder")}
          >
            I'm building or renovating a home
          </button>
          <button
            className="btn w-full !py-3.5 !text-base"
            onClick={() => onChoose("contractor")}
          >
            I'm a contractor
          </button>
        </div>
      </div>
    </div>
  );
}
