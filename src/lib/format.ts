const intWithGroups = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});
const twoDp = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹65,07,837 — Indian digit grouping; shows paise only when present. */
export function inr(n: number): string {
  const fmt = Number.isInteger(Math.round(n * 100) / 100) && Number.isInteger(n)
    ? intWithGroups
    : twoDp;
  return "₹" + fmt.format(n);
}

/** Plain grouped number (no ₹), used inside dense tables. */
export function num(n: number): string {
  return Number.isInteger(n) ? intWithGroups.format(n) : twoDp.format(n);
}

/** Local-time YYYY-MM-DD (never UTC-shifted). */
export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
  return `${Number(d)} ${months[Number(m) - 1]} ${y.slice(2)}`;
}
