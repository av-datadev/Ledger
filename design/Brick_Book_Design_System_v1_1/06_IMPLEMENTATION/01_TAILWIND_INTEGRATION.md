# BRICK BOOK — TAILWIND v4

Semantic CSS variables remain the source of truth. Never put raw hex values in components.

Example @theme mapping:
--color-bb-canvas: var(--bb-bg-canvas);
--color-bb-surface-1: var(--bb-bg-surface-1);
--color-bb-text-primary: var(--bb-text-primary);
--color-bb-brand: var(--bb-brand);

Existing stack remains: React 19 + TypeScript strict + Vite + Tailwind v4.
