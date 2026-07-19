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
  items: ScannedItem[];
}

const UNITS = new Set([
  "pcs", "pc", "nos", "no", "kg", "g", "gm", "ltr", "lt", "l", "ml",
  "mtr", "m", "ft", "sqft", "sq.ft", "bag", "bags", "box", "pkt",
  "set", "pair", "roll", "bndl", "len", "tin", "drum",
]);

const TAX_ROW = /\b(sgst|cgst|igst|gst|freight|packing|round(ing|ed)?( off)?|discount|cartage|labour chg)\b/i;

const JUNK_LINE =
  /\b(gstin|gst no|pan|phone|ph\.|mob|mobile|email|e&oe|thank|terms|condition|state code|hsn code|authori[sz]ed|signat|declar|bank|ifsc|a\/c)\b/i;

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
    items: [],
  };

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
      const m = l.match(
        /(?:invoice|inv|bill|memo|ref)\s*(?:no|num|number|#)?\s*[:.\-]?\s*([A-Za-z0-9][A-Za-z0-9\/-]{0,14})/i,
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
    let unit = "";
    let descEnd = tokens.length;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const raw = tokens[i].replace(/[₹%]/g, "");
      const clean = raw.replace(/,/g, "");
      // Allow negative amounts (Rounding / Discount rows on GST bills).
      if (/^-?\d+(?:\.\d+)?$/.test(clean)) {
        if (!isHsnLike(raw)) numsAtEnd.unshift(num(raw));
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

    if (TAX_ROW.test(desc) && numsAtEnd.length >= 1) {
      bill.items.push({
        item: desc,
        qty: "",
        unit: "",
        rate: "",
        amount: String(numsAtEnd[numsAtEnd.length - 1]),
      });
      continue;
    }

    if (numsAtEnd.length >= 3) {
      // desc [qty] [rate] ... [amount] — take first as qty, last as amount,
      // second-to-last as rate (middle columns like disc% get dropped).
      bill.items.push({
        item: desc,
        qty: String(numsAtEnd[0]),
        unit,
        rate: String(numsAtEnd[numsAtEnd.length - 2]),
        amount: String(numsAtEnd[numsAtEnd.length - 1]),
      });
    } else if (numsAtEnd.length === 2) {
      const [a, b] = numsAtEnd;
      // qty × implied rate = amount, or rate + amount. Assume qty if small.
      bill.items.push({
        item: desc,
        qty: a <= 10000 && a < b ? String(a) : "",
        unit,
        rate: "",
        amount: String(b),
      });
    }
    // A single trailing number is too ambiguous (often pin codes, GST %,
    // serial numbers) — skip rather than pollute the draft.
  }

  return bill;
}
