// Turns a scanned UPI QR code or a photo of a cheque / passbook / bank-details
// slip into a best-effort set of bank fields for a person. Like the bill
// scanner, every value lands back in the form for the user to check — OCR and
// QR contents are both messy in the wild.

export interface ScannedBank {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  upi: string;
}

const emptyBank = (): ScannedBank => ({
  bankName: "",
  accountHolder: "",
  accountNumber: "",
  ifsc: "",
  upi: "",
});

// First four letters of an IFSC are the bank code. A handful of the common
// Indian banks a site would pay — enough to fill the name from a scanned IFSC
// so the user rarely types it. Unknown codes just leave the name blank.
const IFSC_BANKS: Record<string, string> = {
  SBIN: "State Bank of India",
  HDFC: "HDFC Bank",
  ICIC: "ICICI Bank",
  UTIB: "Axis Bank",
  PUNB: "Punjab National Bank",
  BARB: "Bank of Baroda",
  CNRB: "Canara Bank",
  UBIN: "Union Bank of India",
  IOBA: "Indian Overseas Bank",
  IDIB: "Indian Bank",
  CBIN: "Central Bank of India",
  BKID: "Bank of India",
  MAHB: "Bank of Maharashtra",
  KKBK: "Kotak Mahindra Bank",
  YESB: "Yes Bank",
  INDB: "IndusInd Bank",
  IDFB: "IDFC First Bank",
  FDRL: "Federal Bank",
  RATN: "RBL Bank",
  KARB: "Karnataka Bank",
  SIBL: "South Indian Bank",
  CIUB: "City Union Bank",
  UCBA: "UCO Bank",
  PSIB: "Punjab & Sind Bank",
  IBKL: "IDBI Bank",
  AIRP: "Airtel Payments Bank",
  PYTM: "Paytm Payments Bank",
};

const bankFromIfsc = (ifsc: string): string =>
  IFSC_BANKS[ifsc.slice(0, 4).toUpperCase()] ?? "";

// A UPI handle looks like local@psp. Emails also match user@host — the tell is
// that a bank/PSP handle has no dot after the @ (name@okhdfcbank, name@ybl),
// while an email domain does (name@gmail.com). We use that to avoid grabbing an
// email address off a letterhead.
const looksLikeVpa = (s: string): boolean =>
  /^[a-z0-9.\-_]{2,}@[a-z]{2,}$/i.test(s) && !s.split("@")[1].includes(".");

/**
 * Parse a decoded QR payload. UPI QR codes are `upi://pay?pa=<vpa>&pn=<name>…`
 * — the payee address and name are all we need. Returns null if it isn't a
 * recognisable UPI/VPA payload.
 */
export function parseUpiQr(raw: string): ScannedBank | null {
  const text = raw.trim();
  const out = emptyBank();

  // upi://pay?... or the occasional bare "pay?..." — pull the query string.
  const q = text.match(/^(?:upi:\/\/pay|[a-z]+:\/\/[^?]*)\?(.+)$/i);
  if (q) {
    const params = new URLSearchParams(q[1]);
    const pa = params.get("pa")?.trim();
    const pn = params.get("pn")?.trim();
    if (pa && looksLikeVpa(pa)) {
      out.upi = pa;
      if (pn) out.accountHolder = pn;
      return out;
    }
    return null;
  }

  // A QR that just holds the bare VPA.
  if (looksLikeVpa(text)) {
    out.upi = text;
    return out;
  }
  return null;
}

/**
 * Parse OCR text from a photo of a cheque / passbook / details slip. Pulls IFSC
 * (and the bank name it implies), account number, UPI id, and — best-effort —
 * an account-holder name from a labelled line.
 */
export function parseBankText(raw: string): ScannedBank {
  const out = emptyBank();
  const lines = raw
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const flat = lines.join(" ");
  const upper = flat.toUpperCase();

  // IFSC: 4 letters + 0 + 6 alphanumerics. Prefer one next to an "IFSC" label
  // (cheques print an MICR code that can also be 11 chars), else first match.
  const ifscLabeled = upper.match(/IFSC[^A-Z0-9]{0,6}([A-Z]{4}0[A-Z0-9]{6})/);
  const ifscAny = upper.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/);
  const ifsc = ifscLabeled?.[1] ?? ifscAny?.[1] ?? "";
  if (ifsc) {
    out.ifsc = ifsc;
    out.bankName = bankFromIfsc(ifsc);
  }

  // UPI id anywhere in the text.
  const vpa = flat.match(/[a-z0-9.\-_]{2,}@[a-z]{2,}/i);
  if (vpa && looksLikeVpa(vpa[0])) out.upi = vpa[0];

  // Account number: prefer a run of digits sitting next to an A/C label,
  // otherwise the longest 9–18 digit run (bank account lengths), skipping any
  // that's actually the IFSC. Phone numbers (10 digits) are the main false
  // positive, so a labelled hit wins when present.
  const acLabel = flat.match(
    /(?:a\/?c|acc(?:oun)?t)\s*(?:no|number|#)?\s*[:.\-]?\s*(\d[\d ]{7,20}\d)/i,
  );
  if (acLabel) {
    out.accountNumber = acLabel[1].replace(/\D/g, "");
  } else {
    let best = "";
    for (const m of flat.matchAll(/\b\d{9,18}\b/g)) {
      if (m[0].length > best.length) best = m[0];
    }
    out.accountNumber = best;
  }

  // Bank name (if IFSC didn't give it): a line mentioning a known bank word.
  if (!out.bankName) {
    const nameLine = lines.find((l) => /\bbank\b/i.test(l) && l.length <= 40);
    if (nameLine) out.bankName = nameLine.replace(/[|:;]+$/, "").trim();
  }

  // Account holder from a "Name" label, if the slip has one. Matched per line
  // so the capture can't run into the next field, and "Bank name" is excluded.
  if (!out.accountHolder) {
    for (const l of lines) {
      const m = l.match(
        /(?:a\/?c holder|account holder|\bholder\b|(?<!bank )\bname\b)\s*[:.\-]\s*([A-Za-z][A-Za-z .]{2,39})/i,
      );
      if (m) {
        out.accountHolder = m[1].trim().replace(/\s+/g, " ").replace(/ [A-Za-z]$/, "");
        break;
      }
    }
  }

  return out;
}
