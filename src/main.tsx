import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { seedIfEmpty } from "./db";

// First-run-only seed migration, then render. Dexie is local, so this is fast
// and works fully offline.
seedIfEmpty()
  .catch((err) => {
    console.error("Seed migration failed:", err);
  })
  .finally(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
