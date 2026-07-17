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
}

/** A user-added category/payee (e.g. "Electrician", "Painter"). */
export interface CustomCategory {
  id: string;
  name: string;
  createdAt: number;
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
