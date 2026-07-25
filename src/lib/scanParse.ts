// Turns raw OCR text from an Indian shop/GST bill into a best-effort draft
// bill. OCR output is messy — every value lands in the review screen for the
// user to correct, and the lines-sum-vs-total check catches bad numbers.

import { CATEGORY_KEYWORDS, type Category } from "../../shared/constants";

export interface ScannedItem {
  item: string;
  qty: string;
  unit: string;
  rate: string;
  amount: string;
}

export interface ScannedBill {
  vendor: string;
  invoiceNo: string;
  date: string; // YYYY-MM-DD or ""
  category: Category | "";
  invoiceTotal: string;
  gstPct: string; // detected GST rate, e.g. "18"
  otherCharges: string; // freight/packing/cartage, taxed separately from goods
  items: ScannedItem[];
}

const UNITS = new Set([
  "pcs", "pc", "nos", "no", "kg", "g", "gm", "ltr", "lt", "l", "ml",
  "mtr", "m", "ft", "sqft", "sq.ft", "bag", "bags", "box", "pkt",
  "set", "pair", "roll", "bndl", "len", "tin", "drum",
]);

// Pure tax / adjustment rows — never goods, and never part of the taxable
// value. Dropped entirely; the GST is recomputed from the goods subtotal.
// The optional single-letter prefix covers SGST/CGST/IGST/UGST/OGST (bills use
// all of them, and OCR flips C<->O), plus plain GST.
const TAX_ROW = /\b([sciuo])?gst\b|\bround(ing|ed)?(\s*off)?\b|\bdiscount\b|\btax\s*(amount|value)?\b/i;

// Charges that aren't goods but ARE part of what was paid. Captured separately
// so the total reconstructs as goods + GST(goods) + these.
const OTHER_CHARGE = /\b(freight|packing|cartage|transport|loading|unloading|delivery)\b/i;

// Standard Indian GST slabs, plus the half-rates that appear when a bill splits
// the tax into CGST + SGST (9% + 9% = 18%).
const GST_SLABS = new Set([5, 12, 18, 28]);
const HALF_SLABS: Record<string, number> = {
  "2.5": 5, "6": 12, "9": 18, "14": 28,
};

/**
 * Best-effort GST rate for the bill. Bills print it either as a per-item "GST
 * Rate" column (18 %) or as a CGST/SGST pair in the tax summary (9% + 9%), so
 * half-rates are doubled back to the slab. The most frequently seen slab wins;
 * ties go to the higher rate.
 */
function detectGstPct(lines: string[]): string {
  const counts = new Map<number, number>();
  for (const l of lines) {
    for (const m of l.matchAll(/(\d{1,2}(?:\.\d+)?)\s*%/g)) {
      const raw = m[1].replace(/\.0+$/, "");
      const v = parseFloat(raw);
      const slab = GST_SLABS.has(v) ? v : HALF_SLABS[raw];
      if (slab) counts.set(slab, (counts.get(slab) ?? 0) + 1);
    }
  }
  let best = 0;
  let bestN = 0;
  for (const [slab, n] of counts) {
    if (n > bestN || (n === bestN && slab > best)) {
      best = slab;
      bestN = n;
    }
  }
  return best ? String(best) : "";
}

const JUNK_LINE =
  /\b(gstin|gst no|pan|phone|ph\.|mob|mobile|email|e&oe|thank|terms|condition|state code|hsn code|authori[sz]ed|signat|declar|bank|ifsc|a\/c)\b/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Reduce a scanned row's description to just the product name. A bill's item
 * column carries the serial number, the HSN/SAC code and the GST rate around
 * the name ("1 Pvc Conduit Pipe-25mm-Heavy-Norpack 39172310 18 %"), none of
 * which belong in a stock/BOQ row.
 */
function cleanItemName(desc: string): string {
  return desc
    .replace(/^\s*\d{1,3}\s*[.)\-:]?\s+/, "") // leading serial ("1 ", "2. ")
    .replace(/\b\d{6,8}\b/g, " ") // HSN / SAC code
    .replace(/\b\d{1,2}(?:\.\d+)?\s*%/g, " ") // "18 %"
    .replace(/\s+\d{1,2}(?:\.\d+)?\s*$/, "") // bare trailing rate ("… 18")
    .replace(/\s{2,}/g, " ")
    .replace(/[|:;,\-]+$/, "")
    .trim();
}

const num = (s: string): number => parseFloat(s.replace(/,/g, ""));
// Bare 6-8 digit runs are HSN codes; digits with comma separators are amounts.
const isHsnLike = (s: string): boolean => !s.includes(",") && /^\d{6,8}$/.test(s);

function toIsoDate(d: string, m: string, y: string): string | null {
  const day = parseInt(d, 10);
  const mon = parseInt(m, 10);
  let year = parseInt(y, 10);
  if (year < 100) year += 2000;
  if (day < 1 || day > 31 || mon < 1 || mon > 12 || year < 2000 || year > 2100)
    return null;
  return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function guessCategory(text: string): Category | "" {
  const t = text.toLowerCase();
  let best: Category | "" = "";
  let bestScore = 0;
  for (const [keywords, cat] of CATEGORY_KEYWORDS) {
    let score = 0;
    for (const kw of keywords) {
      if (t.includes(kw)) score += kw.length > 4 ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }
  return best;
}

export function parseScannedBill(text: string): ScannedBill {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const bill: ScannedBill = {
    vendor: "",
    invoiceNo: "",
    date: "",
    category: guessCategory(text),
    invoiceTotal: "",
    // Default to 18% when the bill doesn't state a rate — the most common slab
    // for construction material.
    gstPct: detectGstPct(lines) || "18",
    otherCharges: "",
    items: [],
  };
  let otherTotal = 0;

  // Vendor: first "wordy" line near the top that isn't a header keyword.
  for (const l of lines.slice(0, 6)) {
    const letters = l.replace(/[^A-Za-z ]/g, "");
    if (
      letters.length >= 5 &&
      letters.length / l.length > 0.6 &&
      !/tax invoice|invoice|cash memo|estimate|bill of|original|duplicate|authori[sz]ed|dealer|quotation|proforma|\boffer\b/i.test(l)
    ) {
      bill.vendor = l;
      break;
    }
  }

  // Invoice number and date can be anywhere in the top half.
  for (const l of lines) {
    if (!bill.invoiceNo) {
      // "ref" catches quotation/offer references ("Offer Ref : 2026/125").
      // The \b after the keyword matters: without it "inv" matches inside the
      // word "Invoice" on a bare "Tax Invoice" heading and captures the
      // leftover "oice" as the bill number.
      const m = l.match(
        /(?:invoice|inv|bill|memo|ref)\b\s*(?:no|num|number|#)?\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9\/-]{0,14})/i,
      );
      if (m && !/^(no|date|of|for|the)$/i.test(m[1])) bill.invoiceNo = m[1];
    }
    if (!bill.date) {
      const m = l.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
      if (m) {
        const iso = toIsoDate(m[1], m[2], m[3]);
        if (iso) bill.date = iso;
      }
    }
    if (!bill.date) {
      // Tally-style GST invoices print the month as a name ("25-Jul-26"),
      // which the all-numeric pattern above can't read.
      const m = l.match(
        /\b(\d{1,2})[\s\/\-.]*([A-Za-z]{3,9})[\s\/\-.]*(\d{2,4})\b/,
      );
      const mon = m ? MONTHS[m[2].slice(0, 3).toLowerCase()] : undefined;
      if (m && mon) {
        const iso = toIsoDate(m[1], String(mon), m[3]);
        if (iso) bill.date = iso;
      }
    }
  }

  // Grand total: the largest amount on an explicit total line (multi-section
  // bills print sub-totals before the grand total; the grand total is the
  // biggest). Fall back to the largest number anywhere on the bill.
  let fallbackMax = 0;
  let labeledMax = 0;
  for (const l of lines) {
    const nums = l.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
    for (const s of nums) {
      const v = num(s);
      if (!isHsnLike(s) && v > fallbackMax && v < 10_000_000) fallbackMax = v;
    }
    if (/(grand\s*total|net\s*(amt|amount|payable)|total\s*(amt|amount|payable)?\b)/i.test(l) && nums.length) {
      const s = nums[nums.length - 1];
      const v = num(s);
      if (v > labeledMax && !isHsnLike(s) && v < 10_000_000) labeledMax = v;
    }
  }
  if (labeledMax > 0) bill.invoiceTotal = String(labeledMax);
  else if (fallbackMax > 0) bill.invoiceTotal = String(fallbackMax);

  // Line items: lines with leading text and trailing numbers.
  for (const l of lines) {
    if (JUNK_LINE.test(l)) continue;
    if (/(grand\s*total|sub\s*total|net\s*(amt|amount|payable)|^total\b)/i.test(l)) continue;

    // Tokenize; collect trailing numeric tokens (ignoring HSN-looking codes
    // and percent marks) and the leading description.
    const tokens = l.split(" ");
    const numsAtEnd: number[] = [];
    const rawAtEnd: string[] = [];
    let unit = "";
    let descEnd = tokens.length;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const raw = tokens[i].replace(/[₹%]/g, "");
      const clean = raw.replace(/,/g, "");
      // Allow negative amounts (Rounding / Discount rows on GST bills).
      if (/^-?\d+(?:\.\d+)?$/.test(clean)) {
        if (!isHsnLike(raw)) {
          numsAtEnd.unshift(num(raw));
          rawAtEnd.unshift(raw);
        }
        descEnd = i;
      } else if (UNITS.has(raw.toLowerCase().replace(/\.$/, ""))) {
        unit = raw.toLowerCase().replace(/\.$/, "");
        descEnd = i;
      } else {
        break;
      }
    }
    const desc = tokens.slice(0, descEnd).join(" ").replace(/[|:;]+$/, "").trim();
    if (desc.replace(/[^A-Za-z]/g, "").length < 3) continue;
    // Keyword tests below run on the raw text; only the stored name is cleaned.
    const name = cleanItemName(desc);
    if (name.replace(/[^A-Za-z]/g, "").length < 3) continue;

    // Tax / rounding rows are never goods: they'd double-count against the
    // total and put non-material rows into Stock. Dropped — the GST is
    // recomputed from the goods subtotal instead.
    if (TAX_ROW.test(desc)) continue;
    // Freight & friends aren't goods either, but they were paid — keep the
    // amount aside so the total still reconstructs exactly.
    if (OTHER_CHARGE.test(desc)) {
      if (numsAtEnd.length) otherTotal += numsAtEnd[numsAtEnd.length - 1];
      continue;
    }

    if (numsAtEnd.length >= 3) {
      // desc [qty] [rate] ... [amount] — take first as qty, last as amount,
      // second-to-last as rate (middle columns like disc% get dropped).
      bill.items.push({
        item: name,
        qty: String(numsAtEnd[0]),
        unit,
        rate: String(numsAtEnd[numsAtEnd.length - 2]),
        amount: String(numsAtEnd[numsAtEnd.length - 1]),
      });
    } else if (numsAtEnd.length === 2) {
      const [a, b] = numsAtEnd;
      // qty × implied rate = amount, or rate + amount. Assume qty if small.
      bill.items.push({
        item: name,
        qty: a <= 10000 && a < b ? String(a) : "",
        unit,
        rate: "",
        amount: String(b),
      });
    } else if (numsAtEnd.length === 1) {
      // A lone trailing number is usually noise (pin codes, serial numbers,
      // phone digits), so it's only taken when it's clearly *money*: printed
      // with a thousands comma or paise. That keeps rows whose qty/rate columns
      // the reader mangled — previously the whole row was dropped, which is the
      // main reason a bill came back with no items at all.
      const raw = rawAtEnd[0];
      const moneyLike = raw.includes(",") || /\.\d{2}$/.test(raw);
      if (moneyLike && numsAtEnd[0] > 0) {
        bill.items.push({
          item: name,
          qty: "",
          unit,
          rate: "",
          amount: String(numsAtEnd[0]),
        });
      }
    }
  }

  if (otherTotal > 0) {
    bill.otherCharges = String(Math.round(otherTotal * 100) / 100);
  }

  return bill;
}
