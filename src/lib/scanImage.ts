// Prepares a bill photo for on-device OCR: downscale to a sane size,
// grayscale, and stretch contrast so faded thermal/inkjet print reads better.

const MAX_EDGE = 1800;

export async function fileToOcrImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose a photo of the bill (JPG/PNG).");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas unavailable on this device.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    const n = d.length / 4;

    // Grayscale + histogram
    const hist = new Uint32Array(256);
    const gray = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) {
      const g = Math.round(
        0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2],
      );
      gray[i] = g;
      hist[g]++;
    }
    // Contrast stretch between the 5th and 95th percentile
    let lo = 0, hi = 255, acc = 0;
    const p5 = n * 0.05, p95 = n * 0.95;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc <= p5) lo = v;
      if (acc <= p95) hi = v;
    }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < n; i++) {
      const v = Math.max(0, Math.min(255, ((gray[i] - lo) * 255) / range));
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}
