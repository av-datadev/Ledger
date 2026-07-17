import { useCallback, useEffect, useRef } from "react";

/**
 * Ties an open sub-screen to the Android back button: opening pushes a history
 * entry, and pressing back closes the sub-screen instead of exiting the app.
 *
 * Returns a `requestClose` function the sub-screen's own Close/Save buttons
 * should call — it rewinds the pushed entry, and the resulting popstate fires
 * `onClose`. This keeps the history stack consistent whichever way the screen
 * is dismissed, and survives StrictMode's double-mount (the entry is pushed
 * only if not already present).
 */
export function useBackClose(open: boolean, onClose: () => void): () => void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const state = history.state as { modal?: boolean } | null;
    if (!state?.modal) {
      history.pushState({ ...(state ?? {}), modal: true }, "");
    }
    const onPop = () => closeRef.current();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);

  return useCallback(() => {
    if ((history.state as { modal?: boolean } | null)?.modal) {
      history.back(); // popstate → onClose
    } else {
      closeRef.current();
    }
  }, []);
}
