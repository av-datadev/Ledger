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
  otherCharges: string; // freight/packing/cartage — paid, but not goods
  /** True when the bill charges GST on that freight (its row carries an HSN
   * and a rate, e.g. "Freight (GST) 996511 18 %") rather than adding it after
   * the tax. Bills do it both ways, so it has to be read per bill. */
  otherChargesTaxed: boolean;
  /** True for a handwritten "kaccha" bill — no GSTIN, no letterhead, no
   * printed invoice number. Those three are required on a tax invoice and
   * simply absent here, so the review screen stops demanding them. */
  isInformal: boolean;
  /** What was actually handed over against this bill, when the paper records
   * it — a handwritten running account usually does ("जमा 100000"), a printed
   * invoice never does. Empty when nothing is written. */
  paidAmount: string;
  /** What is still owed after that payment ("शेष 11160"). Empty when none. */
  balanceDue: string;
  /** The date beside the payment when it differs from the bill's own date: a
   * bill dated 18/07 can be part-paid on 21/07. Empty otherwise. */
  paymentDate: string;
  items: ScannedItem[];
}

const UNITS = new Set([
  "pcs", "pc", "nos", "no", "kg", "g", "gm", "ltr", "lt", "l", "ml",
  "mtr", "m", "ft", "sqft", "sq.ft", "bag", "bags", "box", "pkt",
  "set", "pair", "roll", "bndl", "len", "tin", "drum",
  // Volume/area/weight units common on Indian construction bills.
  "cft", "cum", "cbm", "brass", "rft", "rmt", "sqm", "quintal", "qtl",
  "ton", "tonne", "mt", "dozen", "doz", "unit", "nos.",
]);

// Units the reader reliably garbles on a photographed bill — the letters sit in
// a narrow column, so "pcs" comes back "pos"/"pes" and "Mtr" comes back "Mr".
// Mapped back so Stock receives a real quantity unit.
const UNIT_FIX: Record<string, string> = {
  pos: "pcs", pes: "pcs", pces: "pcs", nes: "nos", nps: "nos",
  mr: "mtr", mtrs: "mtr", mir: "mtr", mfr: "mtr", kgs: "kg",
};

// Pure tax / adjustment rows — never goods, and never part of the taxable
// value. Dropped entirely; the GST is recomputed from the goods subtotal.
// The optional single-letter prefix covers SGST/CGST/IGST/UGST/OGST (bills use
// all of them, and OCR flips C<->O), plus plain GST.
const TAX_ROW = /\b([sciuo])?gst\b|\bround(ing|ed)?(\s*off)?\b|\bdiscount\b|\btax\s*(amount|value)?\b/i;

// Charges that aren't goods but ARE part of what was paid. Captured separately
// so the total reconstructs as goods + GST(goods) + these. "fr[ae]ight" also
// catches the common OCR misread "Fraight".
const OTHER_CHARGE = /\b(fr[ae]ight|packing|cartage|transport|loading|unloading|delivery)\b/i;

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

// Totals / tax-summary rows a bill prints below the items. They repeat the
// goods value ("Taxable Value 6,78,000") and totals, so capturing them as line
// items double-counts the whole bill — the cause of a scanned bill's computed
// total coming out ~2x. Matched on the raw line and skipped before item parse.
const SUMMARY_LINE =
  /\b(taxable\s*value|invoice\s*value|total\s*(invoice|amount|amt|value|qty|payable|tax)?|sub\s*total|grand\s*total|net\s*(amt|amount|payable)|amount\s*(charge|payable|before)|before\s*tax|in\s*words|balance|carried|previous|outstanding)\b/i;

// The goods table always ends above the "amount in words" / grand-total block.
// Everything below it — the CGST/SGST tax summary, bank details, signatures —
// repeats the bill's numbers and, when OCR mangles its headers, leaks in as
// bogus line items. Stop scanning rows once any of these markers appears.
const END_OF_ITEMS =
  /\bamount\s*chargeable\b|\bin\s*words\b|\be\.?\s*&\s*o\.?\s*e\b|computer\s*generated|company'?s\s*(pan|bank)|authori[sz]ed\s*signat/i;

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
  let s = desc
    .replace(/^[^A-Za-z0-9]+/, "") // leading stray punctuation ('. ', '" ')
    .replace(/^\s*\d{1,3}\s*[.)\-:]?\s+/, ""); // leading serial ("1 ", "2. ")
  // The HSN/SAC code marks the end of the name column; everything from it on is
  // the numeric columns (which OCR smears into the name on a skewed scan —
  // "…Indoasian |as389000 | Spec"). An OCR'd code is 6-8 mostly-digit chars,
  // optionally with a stray leading letter ("8s389000", "as389000"). Cut there.
  s = s.replace(/\s+[|\\/]*\s*[a-z]?[a-z0-9]?\d{4,}[a-z0-9]{0,2}\b.*$/i, "");
  // Also cut at a bare column pipe if one survived before any code.
  s = s.replace(/\s*[|\\]\s*.*$/, "");
  return s
    .replace(/\b\d{6,8}\b/g, " ") // any HSN / SAC code still inline
    .replace(/\b\d{1,2}(?:\.\d+)?\s*%/g, " ") // "18 %"
    .replace(/\s+\d{1,2}(?:\.\d+)?\s*$/, "") // bare trailing rate ("… 18")
    .replace(/\s{2,}/g, " ")
    .replace(/[|:;,\-]+$/, "")
    .trim();
}

const num = (s: string): number => parseFloat(s.replace(/,/g, ""));
// Bare 6-8 digit runs are HSN codes; digits with comma separators are amounts.
const isHsnLike = (s: string): boolean => !s.includes(",") && /^\d{6,8}$/.test(s);

// A trailing table token reduced to its numeric string, tolerating the
// punctuation OCR sprays into column gaps ("21.47|" -> "21.47", "14.69)" ->
// "14.69"). Percent columns ("18%", "9%|") return null so a GST/discount rate
// is never mistaken for a quantity. Only punctuation may surround the digits —
// letters must not, or a hyphenated product name ("Pipe-25mm-Heavy-Norpack")
// reads as the number -25 and swallows the rest of the description.
const asNumber = (raw: string): string | null => {
  if (raw.includes("%")) return null;
  const m = raw
    .replace(/₹/g, "")
    .match(/^[^\dA-Za-z-]*(-?\d[\d,]*(?:\.\d+)?)[^\dA-Za-z]*$/);
  return m ? m[1] : null;
};
// A token with no letters or digits is pure table noise — the column rules and
// stray marks a skewed scan sprays between cells ("|", "\", "=", "»", "®", "~~").
// Never part of a product name, and must not stop the trailing-number scan.
const isPunct = (raw: string): boolean => raw.length > 0 && !/[A-Za-z0-9]/.test(raw);

// Repair two artifacts a skewed scan introduces into a single item row before
// its columns are read:
//   • a thousands separator OCR'd as a space — "4,830.75" comes back as the two
//     tokens "4" and ",830.75", which otherwise read as a stray 4 and 830.75.
//   • the "GST %" column split into "18" + "%", leaving a bare 18 that reads as
//     a quantity. A slab integer immediately before a percent sign is dropped.
const normalizeRow = (tokens: string[]): string[] => {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1] ?? "";
    if (/^\d{1,3}$/.test(t) && /^,\d{3}(?:\.\d+)?\D*$/.test(next)) {
      out.push(t + next);
      i++;
      continue;
    }
    if (/^(?:0|5|12|18|28)$/.test(t) && /^%/.test(next)) continue;
    out.push(t);
  }
  return out;
};

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
    otherChargesTaxed: false,
    // The on-device reader can't do any of this: Tesseract ships English-only
    // traineddata, so it can't read a Devanagari kaccha bill at all, let alone
    // spot a "जमा"/"शेष" pair. Left blank rather than guessed — this path only
    // ever runs offline, on a printed bill, where none of it applies.
    isInformal: false,
    paidAmount: "",
    balanceDue: "",
    paymentDate: "",
    items: [],
  };
  let otherTotal = 0;

  // Vendor: first "wordy" line near the top that isn't a header keyword. OCR
  // frequently glues the vendor name to the adjacent column header on the same
  // scan row ("Gopal Jee Electricals Invoice No. Dated"), so keep only the part
  // before the first header word and judge that.
  const HEADER_CUT =
    /\b(invoice|dated?|gstin|uin|delivery|reference|mode|buyer|dispatch|destination|terms|state\s*name)\b/i;
  for (const l of lines.slice(0, 6)) {
    const head = l.split(HEADER_CUT)[0].trim();
    const letters = head.replace(/[^A-Za-z ]/g, "");
    if (
      letters.replace(/ /g, "").length >= 5 &&
      letters.length / head.length > 0.6 &&
      !/tax invoice|invoice|cash memo|estimate|bill of|original|duplicate|authori[sz]ed|dealer|quotation|proforma|\boffer\b/i.test(head)
    ) {
      bill.vendor = head;
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
        /\b(?:invoice|inv|bill|memo|ref)\b\s*(?:no|num|number|#)?\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9\/-]{0,14})/i,
      );
      // Require a digit: a real invoice number has one, and it rejects the
      // adjacent column header OCR often captures instead ("No", "Dated") when
      // the printed number sits in the cell below the label, not inline.
      if (m && /\d/.test(m[1]) && !/^(no|date|of|for|the)$/i.test(m[1]))
        bill.invoiceNo = m[1];
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

  // Tally-style invoices print "Invoice No." as a boxed column header with the
  // number in the cell BELOW it, so the label and its value land on different
  // OCR lines and the inline match above finds nothing. Fall back to the first
  // standalone number on the label line or the two lines under it. Bare 19xx /
  // 20xx are skipped — on those rows they're the year of the adjacent date.
  if (!bill.invoiceNo) {
    const at = lines.findIndex((l) => /\binv(oice)?\b\s*(no|num|number|#)/i.test(l));
    if (at >= 0) {
      outer: for (const l of lines.slice(at, at + 3)) {
        for (const t of l.split(" ")) {
          if (/^\d{2,6}$/.test(t) && !/^(19|20)\d{2}$/.test(t)) {
            bill.invoiceNo = t;
            break outer;
          }
        }
      }
    }
  }

  // Grand total: the largest amount on the bill. Account and phone numbers are
  // excluded by the HSN and 10-million guards; a "Total"-labeled row is NOT
  // trusted on its own, because tax-summary blocks label their own CGST/SGST
  // subtotals "Total" and those are smaller than the real grand total.
  // A printed amount is its own cell, so it must stand alone as a token (bar a
  // currency prefix or table punctuation). Digits welded to letters belong to
  // an email, a GSTIN or a phone number — "akhil45333@gmail.com" otherwise
  // reads as ₹45,333 and beats the real total.
  const asAmount = (raw: string): number | null => {
    const t = raw.replace(/₹/g, "").replace(/^(?:rs|inr)\.?/i, "");
    const m = t.match(/^[^\dA-Za-z-]*(\d[\d,]*(?:\.\d+)?)[^\dA-Za-z]*$/);
    if (!m || isHsnLike(m[1])) return null;
    const v = num(m[1]);
    return v > 0 && v < 10_000_000 ? v : null;
  };
  const largestAmount = (ls: string[]): number => {
    let max = 0;
    for (const l of ls) {
      for (const t of l.split(" ")) {
        const v = asAmount(t);
        if (v != null && v > max) max = v;
      }
    }
    return max;
  };
  // Scan only the goods table and the grand-total line. The CGST/SGST summary
  // and bank block below them repeat the bill's figures, and a decimal point
  // dropped there ("579.65" -> "57966") would otherwise beat the true total.
  const endAt = lines.findIndex((l) => END_OF_ITEMS.test(l));
  const best =
    (endAt >= 0 ? largestAmount(lines.slice(0, endAt + 1)) : 0) ||
    largestAmount(lines);
  if (best > 0) bill.invoiceTotal = String(best);

  // Line items: lines with leading text and trailing numbers.
  for (const l of lines) {
    if (END_OF_ITEMS.test(l)) break;
    if (JUNK_LINE.test(l)) continue;
    if (SUMMARY_LINE.test(l)) continue;

    // Tokenize; collect the trailing number columns (qty / rate / amount),
    // reading right-to-left and stepping over the noise OCR wedges between them
    // — HSN codes, the "GST %" and per-unit columns, stray table rules — until
    // the product description begins.
    const tokens = normalizeRow(l.split(" "));
    const numsAtEnd: number[] = [];
    let unit = "";
    let descEnd = tokens.length;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const raw = tokens[i];
      const numStr = asNumber(raw);
      if (numStr != null) {
        // Allow negative amounts (Rounding / Discount rows on GST bills).
        if (!isHsnLike(numStr)) numsAtEnd.unshift(num(numStr));
        descEnd = i;
        continue;
      }
      // GST/discount percent column, or a stray column rule — never the name.
      if (raw.includes("%") || isPunct(raw)) {
        descEnd = i;
        continue;
      }
      const asUnit = raw.toLowerCase().replace(/^[|:(\[]+|[.|,)\]]+$/g, "");
      if (UNITS.has(asUnit) || UNIT_FIX[asUnit]) {
        // Keep the left-most unit seen: reading right-to-left, the last one
        // assigned is the qty column's own unit ("150.00 Mtr"), not the
        // per-rate column's repeat ("21.47 Mtr").
        unit = UNIT_FIX[asUnit] ?? asUnit;
        descEnd = i;
        continue;
      }
      // Anything else starts the description. Garbled per-unit columns ("Mtr"
      // -> "Mr", "pcs" -> "pos") are caught by UNIT_FIX above rather than by a
      // generic short-token rule, which would eat real short names like "PVC".
      break;
    }
    const desc = tokens.slice(0, descEnd).join(" ").replace(/[|:;]+$/, "").trim();
    if (desc.replace(/[^A-Za-z]/g, "").length < 3) continue;
    // Keyword tests below run on the raw text; only the stored name is cleaned.
    const name = cleanItemName(desc);
    if (name.replace(/[^A-Za-z]/g, "").length < 3) continue;

    // Tax / rounding rows are never goods: they'd double-count against the
    // total and put non-material rows into Stock. Dropped — the GST is
    // recomputed from the goods subtotal instead.
    // Freight & friends aren't goods either, but they were paid — keep the
    // amount aside so the total still reconstructs exactly. Checked BEFORE
    // TAX_ROW: a freight row billed as a taxable service reads "Freight (GST)",
    // whose "GST" would otherwise match TAX_ROW and drop the charge entirely.
    if (OTHER_CHARGE.test(desc)) {
      if (numsAtEnd.length) otherTotal += numsAtEnd[numsAtEnd.length - 1];
      // That same row tells us whether the freight is taxed: charged as a
      // service it carries its own HSN/SAC code and rate ("996511 18 %").
      if (/\d{1,2}(?:\.\d+)?\s*%/.test(l) || /\b\d{6}\b/.test(l) || /\(\s*gst\s*\)/i.test(l)) {
        bill.otherChargesTaxed = true;
      }
      continue;
    }
    if (TAX_ROW.test(desc)) continue;

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
    }
    // A single trailing number is too ambiguous — it's just as often a summary
    // line's value (Taxable Value, a repeated subtotal) as a real item whose
    // columns the reader mangled. Capturing those double-counted the bill, so a
    // lone number is skipped; that row can be added by hand instead.
  }

  if (otherTotal > 0) {
    bill.otherCharges = String(Math.round(otherTotal * 100) / 100);
  }

  return bill;
}
