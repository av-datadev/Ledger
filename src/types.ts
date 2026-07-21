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
 */
export type MeasureBasis = "qty" | "rft" | "sqft" | "sqm";

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
  // For area/length bases, `qty` holds the derived measure (length, or
  // length×width) so every existing consumer keeps working; `unit` mirrors the
  // basis. `length`/`width` retain the raw inputs so the calculator can reopen.
  basis: MeasureBasis;
  length: number | null;
  width: number | null;
  qty: number | null;
  unit: string | null;
  rate: number | null;
  discPct: number | null;
  amount: number;
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
 * A category/person row (e.g. "Sharik", "Paint", "Electrician"). Built-in
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
 * parts" for splits like Sharik's ₹750 (ground) / ₹725 (upper) floor rates.
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
 * Contact & contract details for a person/contractor (e.g. "Sharik").
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
