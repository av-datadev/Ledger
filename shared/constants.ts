// Single source of truth for the domain enums.

// Built-in categories are the blank-state defaults everyone starts with, so
// they use generic role labels (Contractor, Architect …) — never real people's
// names. A signed-in user's own category names (which may rename these to real
// people) live in their private cloud data and sync down on login.
export const CATEGORIES = [
  "Contractor",
  "Architect",
  "Wood",
  "Electrical",
  "Paint",
  "Plumbing",
  "Tiles",
  "Marble",
  "Aluminium",
  "Govt Fee/Chalan",
  "MDA/Mutation",
  "Gift",
  "Site Prep",
  "Legal",
  "Utility Bill",
  "Misc",
] as const;

// Blank-state default payment modes — generic labels, no real bank/account
// tails. A signed-in user's real modes ride in their cloud data (the `mode`
// field of synced entries) and appear after login.
export const MODES = [
  "Cash",
  "UPI 1",
  "UPI 2",
  "UPI 3",
  "UPI 4",
  "Bank Transfer 1",
  "Cheque",
  "Bank Transfer 2",
  "Other",
] as const;

// Blank-state default payers — generic labels only, never real names. A
// signed-in user's real payers ride along in their cloud data (the `paidBy`
// field of synced entries) and appear after login.
export const PAYERS = [
  "Owner 1",
  "Owner 2",
  "Owner 3",
  "Owner 4",
  "Owner 5",
] as const;

export type Category = (typeof CATEGORIES)[number];
export type Mode = (typeof MODES)[number];
export type Payer = (typeof PAYERS)[number];

// Keyword → category map used by the bill scanner to auto-file a bill
// (and its items) into the right section. First match wins, checked in order.
export const CATEGORY_KEYWORDS: [string[], Category][] = [
  [["paint", "emulsion", "primer", "putty", "distemper", "enamel", "thinner", "varnish", "apex", "tractor", "asian paints", "berger", "nerolac"], "Paint"],
  [["pipe", "cpvc", "upvc", "pvc", "plumb", "tap", "faucet", "cock", "valve", "sanitary", "cistern", "basin", "commode", "elbow", "tee joint"], "Plumbing"],
  [["tile", "tiles", "vitrified", "ceramic", "grout", "kajaria", "somany"], "Tiles"],
  [["marble", "granite", "stone slab", "kota"], "Marble"],
  [["aluminium", "aluminum", "section", "sliding channel", "glazing"], "Aluminium"],
  [["plywood", "ply", "timber", "wood", "sunmica", "laminate", "mdf", "veneer", "teak", "sagwan"], "Wood"],
  [["wire", "cable", "mcb", "switch", "socket", "holder", "led", "electrical", "electric", "fan", "geyser", "conduit", "havells", "anchor", "polycab", "finolex"], "Electrical"],
  [["cement", "sand", "bajri", "gitti", "aggregate", "saria", "sariya", "tmt", "steel bar", "brick", "eent"], "Site Prep"],
];
