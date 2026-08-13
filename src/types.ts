export interface Entry {
  id: string;
  date: string; // YYYY-MM-DD
  category: string;
  event: string;
  detail: string;
  amount: number;
  mode: string;
  paidBy: string;
  notes: string;
  createdAt: number;
  updatedAt: number; // bumped on every edit — powers the Recent tab
}

/**
 * How a BOQ line's / contract's quantity was measured.
 *   qty  — a plain count (pcs, bags, L…)
 *   rft  — running feet: a length × a rate-per-foot
 *   sqft — square feet: length × width × a rate-per-sqft
 *   sqm  — square metre: length × width × a rate-per-sqm
 *   wt   — weight in kg
 *   cft  — cubic feet: how sawn timber is sold. Length in FEET, width and
 *          thickness in INCHES, × pieces — see cftFrom() in lib/measure.
 */
export type MeasureBasis = "qty" | "rft" | "sqft" | "sqm" | "wt" | "cft";

export interface BoqItem {
  id: string;
  // Stable id shared by every row of one bill — survives edits to the
  // vendor/invoice number and is what Stock receipts link back to.
  billId: string;
  date: string;
  category: string;
  vendor: string;
  invoiceNo: string;
  invoiceTotal: number;
  item: string;
  hsn: string | null;
  gstPct: number | null;
  // For area/length/volume bases, `qty` holds the derived measure (length,
  // length×width, or the cubic feet) so every existing consumer keeps working;
  // `unit` mirrors the basis. The raw inputs are retained so the calculator can
  // reopen: `length`/`width` for every measured basis, plus `thickness` and
  // `pieces` for `cft`, where one row is a timber size bought N times over
  // ("8¼ ft × 9 in × 8 in — 3 pieces").
  basis: MeasureBasis;
  length: number | null;
  width: number | null;
  /** cft only: thickness in inches. null on every other basis. */
  thickness: number | null;
  /** cft only: how many pieces of this exact size. null on every other basis. */
  pieces: number | null;
  /**
   * The total quantity the dealer wrote on the slip, repeated on every row of
   * the bill (like `invoiceTotal`). Kept alongside the measured `qty` rather
   * than replacing it: the two were arrived at independently, so keeping both
   * is what lets the bill be re-checked months later.
   */
  writtenQty: number | null;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  discPct: number | null;
  amount: number;
  /**
   * How much of this bill has actually been handed over, repeated on every row
   * of the bill (like `invoiceTotal`). `invoiceTotal - amountPaid` is what the
   * vendor is still owed.
   *
   * null means the bill says nothing about payment, which is NOT the same as a
   * payment of zero: a printed invoice that arrived unpaid and a bill paid in
   * full both have an outstanding figure worth showing, but a bill nobody has
   * recorded a payment against should not claim the whole total is due.
   */
  amountPaid: number | null;
  /**
   * True when the bill is kept as one line rather than as its items. The rows
   * are still stored and still open on tap — a handwritten bill's twenty
   * Devanagari rows are worth keeping as evidence even when nobody wants them
   * itemised — but the bill reads, and stocks, as a single line.
   */
  clubbed: boolean | null;
}

export interface Settings {
  id: string; // always "app"
  lastBackupDate: string | null; // ISO timestamp
  budget: number | null; // total project budget (₹); null = not set
  // The house/project address shown on the Dashboard.
  homeAddress: string;
  state: string;
  city: string;
}

/**
 * A category/person row (e.g. "Contractor", "Paint", "Electrician"). Built-in
 * categories are seeded as rows too, so every one can be renamed or removed.
 */
export interface CustomCategory {
  id: string;
  name: string;
  order: number; // display position; lower = higher in the list
  createdAt: number;
}

/**
 * One floor/section line of a contract (e.g. "Ground floor · 1000 sqft @ ₹750").
 * Each line is a mini-contract in its own right: "lumpsum" carries a flat
 * `amount`, otherwise `amount` = `area` × `rate`. A person's contract total is
 * the sum of its lines — this is how the single-total contract is "built from
 * parts" for splits like a contractor's ₹750 (ground) / ₹725 (upper) floor rates.
 */
export interface ContractLine {
  id: string;
  label: string; // "Ground floor", "First floor", "Terrace"…
  basis: "lumpsum" | MeasureBasis;
  area: number | null; // measured quantity (running ft or area); null for lumpsum
  rate: number | null; // rate per unit (₹); null for lumpsum
  amount: number | null; // lumpsum price, or the derived area × rate
}

/**
 * Contact & contract details for a person/contractor (e.g. "Contractor").
 * Linked by `name` to a category/payee, so it works for both built-in
 * people and ones added on the People tab. Every field is optional to fill.
 */
export interface PersonDetails {
  id: string;
  name: string; // the person/category name these details belong to
  role: string; // Contractor, Labour, Mason, Electrician…
  phone: string;
  idNumber: string; // Aadhaar / PAN / any ID number
  // Contract pricing. "lumpsum" = a flat agreed price in contractAmount.
  // Otherwise contractAmount = contractArea × contractRate (e.g. 2000 sqft
  // @ ₹1200), with the basis giving the unit.
  //
  // When `contractLines` is non-empty the contract is built floor-wise: the
  // lines are the source of truth and `contractAmount` mirrors their sum (the
  // single-field trio below is then unused). An empty `contractLines` keeps the
  // original single-total behaviour.
  contractBasis: "lumpsum" | MeasureBasis;
  contractArea: number | null; // measured quantity (running ft or area)
  contractRate: number | null; // rate per unit (₹)
  contractAmount: number | null; // agreed final price (₹) — sum of lines when floor-wise
  contractLines: ContractLine[]; // per-floor/section breakdown; [] = single total
  contractDetails: string; // scope / terms / anything else
  // Bank details for paying this person.
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  upi: string;
  createdAt: number;
  updatedAt: number;
}

/** A material being tracked in inventory (e.g. "Apex Ultima White 20L"). */
export interface StockItem {
  id: string;
  name: string;
  category: string;
  unit: string; // pcs, L, kg, bag, sqft, …
  done: boolean; // checked off = fully used / settled
  createdAt: number;
}

/**
 * A photo attached to a ledger entry as proof — a cheque, a handwritten diary
 * page, a receipt. Stored on-device as a downscaled JPEG blob; nothing is
 * uploaded. Kept in its own table so entry rows stay light.
 */
export interface Attachment {
  id: string;
  entryId: string; // the Entry this photo belongs to
  blob: Blob; // downscaled JPEG image data
  mime: string; // "image/jpeg"
  name: string; // original file name, best-effort
  w: number; // stored pixel dimensions (for layout)
  h: number;
  createdAt: number;
}

/**
 * A site a contractor is working on. The contractor side of the app is
 * multi-site by nature — a contractor runs several houses at once, and the
 * whole problem is keeping each one's money separate.
 *
 * Device-local and never synced: sync is built around a household (the owners
 * of one house), and a contractor belongs to none. Keeping these out of the
 * sync engine also means a contractor's own books are never visible to any
 * homeowner, which is the only version of this they'd actually use.
 */
export interface ContractorSite {
  id: string;
  name: string; // "Verma house — Civil Lines"
  ownerName: string;
  ownerPhone: string;
  address: string;
  contractAmount: number | null; // agreed price for the whole job, if fixed
  startDate: string; // YYYY-MM-DD
  status: "active" | "done";
  notes: string;
  /** When the owner has approved a link, the `site_links.id` joining this site
   * to their household. null = a private site kept on this phone only. */
  linkId: string | null;
  /** Mirrors the link's server-side status so the UI can say "waiting for the
   * owner" without a round trip on every render. */
  linkStatus: "pending" | "approved" | "revoked" | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * One money movement on a contractor's site: cash taken from the owner, or
 * money spent on the job. `proof` is what turns a claim into a record — the
 * photographed bill, challan or weighment slip behind a spend.
 */
export interface SiteLedgerRow {
  id: string;
  siteId: string;
  date: string; // YYYY-MM-DD
  /** "received" = money in from the owner; the rest are money out. */
  kind: "received" | "material" | "labour" | "other";
  description: string;
  amount: number;
  /** Photographed bill/slip backing a spend. Held inline rather than in the
   * `attachments` table, which is entry-scoped and part of household sync. */
  proof: Blob | null;
  proofName: string;
  notes: string;
  /** Set once this row has been shown to the site owner — the id of its
   * `shared_entries` counterpart. null = private to this phone. Sharing is
   * per-row and opt-in: a contractor's own margin notes stay his. */
  sharedId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** One quantity movement: received into stock, or given out to labour. */
export interface StockMove {
  id: string;
  stockId: string;
  date: string; // YYYY-MM-DD
  kind: "in" | "out";
  qty: number;
  note: string; // e.g. "Bill #2310 Gopal Jee" or "Given to painter"
  // When this receipt came from a BOQ bill, the bill's stable id — the hard
  // link that powers the two-way BOQ↔Stock views. null for manual movements.
  billId: string | null;
  createdAt: number;
}
