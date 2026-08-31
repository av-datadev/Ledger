import { useCallback, useEffect, useRef, useState } from "react";
import { useBackClose } from "../hooks/useBackClose";
import { Icon } from "./Icon";

/**
 * The destructive-action confirm, replacing `window.confirm()`.
 *
 * Five destructive paths used the browser's own dialog. Inside the Android TWA
 * that renders as a Chrome sheet with the origin printed on it — it ignores the
 * theme, ignores the text-size setting, and looks like the page has been taken
 * over by something else at exactly the moment a person needs to trust it.
 *
 * The control flow is deliberately identical to the thing it replaces, so no
 * caller's logic changes:
 *
 *     if (!(await confirm({ ... }))) return;      // was: if (!window.confirm(…))
 *
 * Spec (design.md §5.10): sheet layout, a title stating the consequence, a line
 * naming exactly what is lost, Cancel on the left holding focus, the
 * destructive action on the right. Escape and the Android back gesture both
 * close it, the same as every other sheet in the app.
 */

export interface ConfirmRequest {
  /** States the consequence, as a question. "Delete this payment?" */
  title: string;
  /** Names exactly what is lost. Counts, not "all data". */
  body: string;
  /** Optional second line — what is NOT affected, when that is reassuring. */
  note?: string;
  /** The destructive button's label. Says what happens: "Delete payment". */
  confirmLabel: string;
  cancelLabel?: string;
}

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

/**
 * Returns [confirm, sheet]. Render `sheet` anywhere in the component; call
 * `confirm(...)` and await the answer.
 */
export function useConfirm(): [
  (req: ConfirmRequest) => Promise<boolean>,
  React.ReactNode,
] {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (req: ConfirmRequest) =>
      new Promise<boolean>((resolve) => setPending({ ...req, resolve })),
    [],
  );

  const settle = useCallback(
    (ok: boolean) => {
      setPending((p) => {
        p?.resolve(ok);
        return null;
      });
    },
    [],
  );

  const sheet = pending ? (
    <ConfirmSheet request={pending} onSettle={settle} />
  ) : null;

  return [confirm, sheet];
}

function ConfirmSheet({
  request,
  onSettle,
}: {
  request: ConfirmRequest;
  onSettle: (ok: boolean) => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The answer travels through the history rewind: whichever way the sheet is
  // dismissed — button, Escape, scrim, or the Android back gesture — it closes
  // through the same path, so the history stack cannot drift out of step.
  const answer = useRef(false);
  const requestClose = useBackClose(true, () => onSettle(answer.current));

  const settleWith = useCallback(
    (ok: boolean) => {
      answer.current = ok;
      requestClose();
    },
    [requestClose],
  );

  // Focus starts on Cancel — the safe choice is the one under the thumb.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Escape closes, and focus is trapped while the sheet is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        settleWith(false);
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled])",
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settleWith]);

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => settleWith(false)}
      />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        className="absolute inset-x-0 bottom-0 bg-surface rounded-t-lg shadow-2xl px-4 pt-3 pb-6"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)" }}
      >
        <div className="w-9 h-1 rounded-full bg-rule-strong mx-auto mb-4" />
        <h2 id="confirm-title" className="text-[17px] leading-tight">
          {request.title}
        </h2>
        <p id="confirm-body" className="text-[13px] leading-relaxed mt-2">
          {request.body}
        </p>
        {request.note && (
          <p className="text-[11px] text-ink-faint mt-2">{request.note}</p>
        )}
        <div className="grid grid-cols-2 gap-2 mt-5">
          <button
            ref={cancelRef}
            className="btn !py-3"
            onClick={() => settleWith(false)}
          >
            {request.cancelLabel ?? "Cancel"}
          </button>
          <button
            className="btn btn-danger !py-3 gap-1.5"
            onClick={() => settleWith(true)}
          >
            <Icon name="warn" size={16} />
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
