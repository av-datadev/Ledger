import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { CATEGORIES } from "../../shared/constants";
import type { CustomCategory } from "../types";

/**
 * Order categories for display: "Misc" stays last as the catch-all, everything
 * else sorts by its `order` (built-ins first, in canonical order), then by
 * creation time for rows that share an order (user-added ones).
 */
export function sortCategories(rows: CustomCategory[]): CustomCategory[] {
  return rows.slice().sort((a, b) => {
    if (a.name === "Misc") return 1;
    if (b.name === "Misc") return -1;
    if (a.order !== b.order) return a.order - b.order;
    return a.createdAt - b.createdAt;
  });
}

/**
 * The effective category list. Every category (built-in or user-added) lives in
 * the `categories` table, so this reads straight from it. Live — updates
 * everywhere the moment a category is added, renamed, or removed.
 */
export function useCategories(): string[] {
  const rows = useLiveQuery(() => db.categories.toArray(), []);
  // Still loading the table on first paint — fall back to the built-in names so
  // dropdowns are never momentarily empty.
  if (rows === undefined) return [...CATEGORIES];
  return sortCategories(rows).map((c) => c.name);
}
