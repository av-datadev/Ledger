/**
 * Token matching for the on-screen search boxes.
 *
 * Every whitespace-separated token has to appear SOMEWHERE in the haystack, in
 * any order — so "tee 1" finds `Brass Tee 1"` and "brass 3/4" finds
 * `Brass Elbow 3/4x1/2"`. A plain substring test would fail both, because
 * nobody types a material's name in the order the dealer wrote it.
 *
 * No fuzzy matching on purpose. These names are dense with digits and
 * fractions (1, 1.5, 3/4, 1/2) where an edit-distance match would rank
 * `T 1 inch` and `T 1.5 inch` as near-identical — and picking the wrong one
 * writes a handout against the wrong material.
 */
export function matchesQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return tokens.every((t) => hay.includes(t));
}
