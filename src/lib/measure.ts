import type { MeasureBasis, ContractLine } from "../types";

export type ContractBasis = "lumpsum" | MeasureBasis;

interface BasisMeta {
  label: string; // shown in the picker
  unit: string; // stored as the row's unit + shown after amounts
  area: boolean; // true = needs length × width; false = a single length/count
  measureLabel: string; // label for the primary (non-qty) measurement input
}

/** Everything the UI needs to know about each measurement basis. */
export const BASIS: Record<MeasureBasis, BasisMeta> = {
  qty: { label: "Quantity", unit: "", area: false, measureLabel: "Qty" },
  rft: { label: "Running ft", unit: "rft", area: false, measureLabel: "Length" },
  sqft: { label: "Sq ft", unit: "sqft", area: true, measureLabel: "Length" },
  sqm: { label: "Sq m", unit: "sqm", area: true, measureLabel: "Length" },
  // Steel/TMT and cement are sold by weight: weight (kg) × rate = amount.
  wt: { label: "Weight", unit: "kg", area: false, measureLabel: "Weight" },
};

export const MEASURE_BASES: MeasureBasis[] = ["qty", "rft", "sqft", "sqm", "wt"];
export const CONTRACT_BASES: ContractBasis[] = ["lumpsum", "rft", "sqft", "sqm"];

export function basisLabel(basis: ContractBasis): string {
  return basis === "lumpsum" ? "Lump sum" : BASIS[basis].label;
}

export function basisUnit(basis: ContractBasis): string {
  return basis === "lumpsum" ? "" : BASIS[basis].unit;
}

/**
 * The derived measure for a BOQ line: length for rft, length×width for an area
 * basis, otherwise the plain count. Returns null when the inputs needed for the
 * basis are missing, so callers can leave the amount blank.
 */
export function deriveMeasure(
  basis: MeasureBasis,
  length: number | null,
  width: number | null,
  count: number | null,
): number | null {
  if (basis === "qty") return count;
  // rft and wt are single-value bases: the primary input (running feet /
  // kilograms) IS the measure.
  if (basis === "rft" || basis === "wt") return length;
  // Area bases need both sides.
  if (length == null || width == null) return null;
  return round3(length * width);
}

/** measure × rate, rounded to paise; null when either side is missing. */
export function amountFrom(
  measure: number | null,
  rate: number | null,
): number | null {
  if (measure == null || rate == null) return null;
  return Math.round(measure * rate * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** A single contract line's value: its lumpsum amount, or area × rate. */
export function lineAmount(line: ContractLine): number | null {
  if (line.basis === "lumpsum") return line.amount;
  return amountFrom(line.area, line.rate);
}

/** Sum of every line that has a value; null when none contribute. */
export function sumLines(lines: ContractLine[]): number | null {
  const vals = lines
    .map(lineAmount)
    .filter((n): n is number => n != null);
  if (!vals.length) return null;
  return Math.round(vals.reduce((s, n) => s + n, 0) * 100) / 100;
}

/**
 * A person's agreed contract value. Floor-wise lines win when present (total =
 * their sum); otherwise it falls back to the single lumpsum / area × rate.
 */
export function contractTotal(p: {
  contractLines?: ContractLine[] | null;
  contractBasis: ContractBasis;
  contractArea: number | null;
  contractRate: number | null;
  contractAmount: number | null;
}): number | null {
  if (p.contractLines && p.contractLines.length) return sumLines(p.contractLines);
  if (p.contractBasis === "lumpsum") return p.contractAmount;
  return amountFrom(p.contractArea, p.contractRate);
}
