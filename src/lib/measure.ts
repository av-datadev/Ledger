import type { MeasureBasis, ContractLine } from "../types";

export type ContractBasis = "lumpsum" | MeasureBasis;

interface BasisMeta {
  label: string; // shown in the picker
  unit: string; // stored as the row's unit + shown after amounts
  area: boolean; // true = needs length × width; false = a single length/count
  /** true = a solid measured as length × width × thickness × pieces (cft). */
  volume: boolean;
  measureLabel: string; // label for the primary (non-qty) measurement input
}

/** Everything the UI needs to know about each measurement basis. */
export const BASIS: Record<MeasureBasis, BasisMeta> = {
  qty: { label: "Quantity", unit: "", area: false, volume: false, measureLabel: "Qty" },
  rft: { label: "Running ft", unit: "rft", area: false, volume: false, measureLabel: "Length" },
  sqft: { label: "Sq ft", unit: "sqft", area: true, volume: false, measureLabel: "Length" },
  sqm: { label: "Sq m", unit: "sqm", area: true, volume: false, measureLabel: "Length" },
  // Steel/TMT and cement are sold by weight: weight (kg) × rate = amount.
  wt: { label: "Weight", unit: "kg", area: false, volume: false, measureLabel: "Weight" },
  // Sawn timber is sold by the cubic foot, quoted as a size and a piece count.
  cft: { label: "Cu ft (wood)", unit: "cft", area: true, volume: true, measureLabel: "Length" },
};

export const MEASURE_BASES: MeasureBasis[] = ["qty", "rft", "sqft", "sqm", "wt", "cft"];
export const CONTRACT_BASES: ContractBasis[] = ["lumpsum", "rft", "sqft", "sqm"];

export function basisLabel(basis: ContractBasis): string {
  return basis === "lumpsum" ? "Lump sum" : BASIS[basis].label;
}

export function basisUnit(basis: ContractBasis): string {
  return basis === "lumpsum" ? "" : BASIS[basis].unit;
}

/** The raw measurement inputs of one line; which ones matter is basis-specific. */
export interface Dims {
  /** Length — feet for rft/sqft/cft, metres for sqm, kilograms for wt. */
  length: number | null;
  /** Width — feet/metres for the area bases, INCHES for cft. */
  width: number | null;
  /** Thickness in INCHES. cft only. */
  thickness: number | null;
  /** How many pieces of this size. cft only; blank counts as one. */
  pieces: number | null;
  /** The plain count, for the `qty` basis. */
  count: number | null;
}

export const blankDims = (): Dims => ({
  length: null,
  width: null,
  thickness: null,
  pieces: null,
  count: null,
});

/**
 * Cubic feet of sawn timber, in the convention every Indian timber dealer
 * writes on the slip: **length in FEET × width in INCHES × thickness in INCHES
 * ÷ 144**, times the number of pieces of that size.
 *
 * The 144 is the unit conversion, not a fudge: two of the three sides are in
 * inches, so the product is ft·in² and 144 in² = 1 ft².
 *
 * e.g. a teak line written "8¼ × 9 × 6 — 3 pcs" is
 * 8.25 × 9 × 6 ÷ 144 × 3 = 9.281 cft.
 *
 * Returns null when any of the three dimensions is missing.
 */
export function cftFrom(
  lengthFt: number | null,
  widthIn: number | null,
  thicknessIn: number | null,
  pieces: number | null,
): number | null {
  if (lengthFt == null || widthIn == null || thicknessIn == null) return null;
  // A blank piece count means the single piece the size describes — a dealer
  // only writes the count when it's more than one.
  const n = pieces == null || pieces <= 0 ? 1 : pieces;
  return round3((lengthFt * widthIn * thicknessIn * n) / 144);
}

/**
 * The derived measure for a BOQ line: length for rft, length×width for an area
 * basis, cubic feet for cft, otherwise the plain count. Returns null when the
 * inputs needed for the basis are missing, so callers can leave the amount blank.
 */
export function deriveMeasure(basis: MeasureBasis, d: Dims): number | null {
  if (basis === "qty") return d.count;
  // rft and wt are single-value bases: the primary input (running feet /
  // kilograms) IS the measure.
  if (basis === "rft" || basis === "wt") return d.length;
  if (basis === "cft") return cftFrom(d.length, d.width, d.thickness, d.pieces);
  // Area bases need both sides.
  if (d.length == null || d.width == null) return null;
  return round3(d.length * d.width);
}

/**
 * Read a dimension the way it's written by hand: a decimal ("8.25"), a mixed
 * fraction ("8 1/4", "8-1/4"), a bare fraction ("1/2"), or a vulgar-fraction
 * glyph ("8¼"). Dealers write ¼ and ½ constantly, and a phone keyboard can't
 * type them — so accept every spelling and normalise to a number.
 *
 * Returns null for anything that isn't a positive measurement.
 */
export function parseDimension(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Feet-and-inches ("8'6", 8'6"") — read before the marks are stripped, and
  // only when the second part is a whole/decimal number. A fraction after the
  // foot mark ("8'1/4") is quarters of a FOOT, not inches, so it falls through
  // to the fraction branch below.
  const ftIn = trimmed.match(/^(\d+)\s*['′]\s*(\d+(?:\.\d+)?)\s*["″]?$/);
  if (ftIn) {
    const v = parseInt(ftIn[1], 10) + parseFloat(ftIn[2]) / 12;
    return v > 0 ? round3(v) : null;
  }
  // Otherwise the foot/inch mark becomes a SPACE, not nothing: dealers write
  // the mixed fraction as "8'1/4", and deleting the mark would weld it into
  // "81/4" — a reading of 20.25 ft instead of 8.25 ft.
  let s = trimmed.replace(/[′'"″]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  // Vulgar-fraction glyphs, whether or not a whole number precedes them.
  for (const [glyph, value] of Object.entries(VULGAR)) {
    if (s.includes(glyph)) s = s.replace(glyph, ` ${value}`);
  }
  s = s.trim();
  // "8 1/4" / "8-1/4" / "1/4" / "8.25"
  const m = s.match(/^(?:(\d+(?:\.\d+)?)\s*[-\s]\s*)?(\d+)\s*\/\s*(\d+)$/);
  if (m) {
    const whole = m[1] ? parseFloat(m[1]) : 0;
    const den = parseInt(m[3], 10);
    if (!den) return null;
    const v = whole + parseInt(m[2], 10) / den;
    return v > 0 ? round3(v) : null;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const VULGAR: Record<string, string> = {
  "¼": "1/4", "½": "1/2", "¾": "3/4",
  "⅓": "1/3", "⅔": "2/3",
  "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8",
};

/**
 * measure × rate, less any trade discount, rounded to paise; null when either
 * side is missing.
 *
 * The discount is the bill's own "Disc. %" column. Wholesale electrical and
 * sanitary invoices print the maker's LIST rate and then knock 40–70% off it
 * per row ("10 cl @ 5,000.00, 50 %, 25,000.00"), so a row priced as plain
 * qty × rate comes out more than double the printed amount — and the bill then
 * refuses to save, because its rows exceed its own total.
 */
export function amountFrom(
  measure: number | null,
  rate: number | null,
  discPct: number | null = null,
): number | null {
  if (measure == null || rate == null) return null;
  const keep = discPct != null && discPct > 0 && discPct < 100 ? 1 - discPct / 100 : 1;
  return Math.round(measure * rate * keep * 100) / 100;
}

/**
 * The discount a row must carry for its printed figures to agree, when the
 * reader returned the list rate and the discounted amount but not the
 * percentage between them. Returns null unless the gap is a clean percentage
 * (to the half-percent, at most 80%) that reproduces the amount to within a
 * rupee — a gap that isn't is far more likely a misread quantity than a
 * discount, and inventing one would hide that.
 */
export function impliedDiscPct(
  qty: number | null,
  rate: number | null,
  amount: number | null,
): number | null {
  if (!qty || !rate || !amount || qty <= 0 || rate <= 0 || amount <= 0) return null;
  const gross = qty * rate;
  if (gross - amount < 1) return null;
  const pct = Math.round((1 - amount / gross) * 200) / 2;
  // Trade discounts run to about 70%. Past 80 the likelier story is a quantity
  // read too high: a ticked "10" read as "40" quarters the implied price, which
  // can land on a clean-looking 85–90% "discount".
  if (pct <= 0 || pct > 80) return null;
  const back = amountFrom(qty, rate, pct);
  return back != null && Math.abs(back - amount) <= 1 ? pct : null;
}

/** Units a thing is sold by that are a fixed length of something longer — a
 * coil of wire, a roll of pipe — so "how many metres" is worth recording
 * alongside "how many coils". */
const LENGTH_PACKS = /^(cl|coil|coils|roll|rolls|rl|bndl|bundle|bundles|drum|drums|reel|reels)$/i;
/** Units that are already a length, where a per-unit length means nothing. */
const LENGTH_UNITS = /^(m|mtr|mtrs|meter|metre|meters|metres|rmt|rm|ft|feet|rft)$/i;

/** True when a row's unit is a coil/roll/bundle, so its length per unit applies. */
export function isLengthPack(unit: string): boolean {
  return LENGTH_PACKS.test(unit.trim().replace(/\.$/, ""));
}

/**
 * Metres in ONE unit of a coil/roll row, read from the product name the way
 * every wire and pipe maker prints it: "WIRE 1MM 180MTR FR …" → 180,
 * "Conduit 90 m roll" → 90. Null when the name gives no length, or when the
 * unit is already a length (a row bought in metres needs no per-unit figure).
 *
 * The wire's gauge ("1MM", "2.5 mm") is a millimetre figure and must not read
 * as metres — the trailing \b after a lone "m" is what rejects "1MM".
 */
export function lengthPerUnitFromName(name: string, unit: string): number | null {
  if (LENGTH_UNITS.test(unit.trim().replace(/\.$/, ""))) return null;
  const m = name.match(/(\d+(?:\.\d+)?)\s*(?:mtrs?|meters?|metres?|m)\b/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
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
