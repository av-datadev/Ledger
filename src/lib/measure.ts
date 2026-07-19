import type { MeasureBasis } from "../types";

export type ContractBasis = "lumpsum" | MeasureBasis;

interface BasisMeta {
  label: string; // shown in the picker
  unit: string; // stored as the row's unit + shown after amounts
  area: boolean; // true = needs length × width; false = a single length/count
}

/** Everything the UI needs to know about each measurement basis. */
export const BASIS: Record<MeasureBasis, BasisMeta> = {
  qty: { label: "Quantity", unit: "", area: false },
  rft: { label: "Running ft", unit: "rft", area: false },
  sqft: { label: "Sq ft", unit: "sqft", area: true },
  sqm: { label: "Sq m", unit: "sqm", area: true },
};

export const MEASURE_BASES: MeasureBasis[] = ["qty", "rft", "sqft", "sqm"];
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
  if (basis === "rft") return length;
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
