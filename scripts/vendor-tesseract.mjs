// Copies the tesseract.js runtime assets we self-host into public/tesseract.
//
// Why this exists: these files used to be copied by hand, and one variant got
// missed. tesseract.js feature-detects the best WASM build at runtime and asks
// for whichever it picks — on browsers with relaxed-SIMD support that's
// `tesseract-core-relaxedsimd-lstm.wasm.js`. If that file isn't hosted, the
// worker's importScripts() throws a NetworkError and every scan fails, even
// though the other variants are present. Copying all of them from the
// installed package keeps the folder in sync with whatever version is in
// node_modules, so an npm upgrade can't silently break scanning again.

import { mkdir, copyFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "tesseract");

// Each entry: [source file, package it comes from]. The *.wasm.js builds are
// self-contained (the wasm is embedded), which is why the bare .wasm files
// aren't needed. All three LSTM variants ship because the runtime chooses one
// based on the browser's SIMD support.
const ASSETS = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  [
    "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
    "tesseract-core-relaxedsimd-lstm.wasm.js",
  ],
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "eng.traineddata.gz"],
];

const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

await mkdir(outDir, { recursive: true });

let copied = 0;
const missing = [];
for (const [from, to] of ASSETS) {
  const src = join(root, "node_modules", from);
  if (!(await exists(src))) {
    missing.push(from);
    continue;
  }
  await copyFile(src, join(outDir, to));
  copied++;
}

console.log(`vendor-tesseract: copied ${copied}/${ASSETS.length} assets`);
if (missing.length) {
  // Hard-fail: a missing core variant only shows up as a broken scan at
  // runtime on some devices, which is far more expensive to diagnose.
  console.error("vendor-tesseract: MISSING from node_modules:");
  for (const m of missing) console.error("  - " + m);
  process.exit(1);
}
