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

export interface BoqItem {
  id: string;
  date: string;
  category: string;
  vendor: string;
  invoiceNo: string;
  invoiceTotal: number;
  item: string;
  hsn: string | null;
  gstPct: number | null;
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
  contractAmount: number | null; // agreed final price (₹)
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

/** One quantity movement: received into stock, or given out to labour. */
export interface StockMove {
  id: string;
  stockId: string;
  date: string; // YYYY-MM-DD
  kind: "in" | "out";
  qty: number;
  note: string; // e.g. "Bill #2310 Gopal Jee" or "Given to painter"
  createdAt: number;
}
