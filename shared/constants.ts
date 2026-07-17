// Single source of truth for the domain enums.

export const CATEGORIES = [
  "Sharik",
  "Nitin",
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

export const MODES = [
  "Cash",
  "GPay (SBI - 8101)",
  "GPay (DCB 0003)",
  "GPay (Deutsche Bank)",
  "GPay (PNB)",
  "SBI 8101",
  "Cheque",
  "SBI FD MDA",
  "Other",
] as const;

export const PAYERS = [
  "Rajesh Verma",
  "Sanjeev Verma",
  "Sachin Verma",
  "Chitra Verma",
  "Apoorv Verma",
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
