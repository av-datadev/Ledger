import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../db";
import { CATEGORIES } from "../../shared/constants";

/**
 * The effective category list: built-in categories plus any the user added in
 * the People tab. Custom names slot in alphabetically before "Misc" (which
 * stays last as the catch-all). Live — updates everywhere the moment a
 * category is added or removed.
 */
export function useCategories(): string[] {
  const custom = useLiveQuery(() => db.categories.toArray(), []);
  const customNames = (custom ?? [])
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b));

  const builtinsExceptMisc = CATEGORIES.filter((c) => c !== "Misc");
  const merged: string[] = [...builtinsExceptMisc];
  const seen = new Set(merged.map((c) => c.toLowerCase()));
  for (const name of customNames) {
    if (!seen.has(name.toLowerCase())) {
      merged.push(name);
      seen.add(name.toLowerCase());
    }
  }
  merged.push("Misc");
  return merged;
}
