// Reads a photographed Indian GST bill with Gemini vision and returns
// structured line items. This replaces on-device OCR (Tesseract) as the
// primary path when the phone is online — Tesseract stays as the offline
// fallback (see src/lib/geminiScan.ts). GEMINI_API_KEY is a Supabase Edge
// Function secret; it is never sent to the client.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL = "gemini-3.6-flash";

// The browser calls this function directly (supabase.functions.invoke), which
// sends a CORS preflight OPTIONS request first — without these headers the
// browser blocks the real request before it's ever sent.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    vendor: { type: "string", description: "The selling company's name (the printed letterhead), not the buyer's name." },
    invoiceNo: { type: "string" },
    date: { type: "string", description: "ISO date YYYY-MM-DD. Bills often print it as '25-Jul-26' or '23-05-2026'." },
    invoiceTotal: { type: "number", description: "The final amount actually payable (the grand total row), not a mid-table subtotal." },
    gstPct: { type: "number", description: "The overall GST slab for the bill (5, 12, 18 or 28). If CGST+SGST are printed as two 9% rows, report 18, not 9." },
    otherCharges: { type: "number", description: "Freight, packing, cartage or loading charges — paid, but not goods. 0 if none are printed." },
    otherChargesTaxed: { type: "boolean", description: "True only if GST is charged ON the freight — i.e. the freight row carries its own HSN/SAC code and rate (e.g. 'Freight (GST) 996511 18 %'), or the tax summary's taxable value includes the freight amount. False when freight is a plain add-on with no HSN and no rate." },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: { type: "string", description: "Product name only — no serial number, HSN code, or GST %." },
          qty: { type: "number" },
          unit: { type: "string", description: "As printed: pcs, Mtr, kg, bag, cft, etc." },
          rate: { type: "number" },
          amount: { type: "number" },
        },
        required: ["item", "qty", "unit", "rate", "amount"],
      },
    },
  },
  required: ["vendor", "invoiceNo", "date", "invoiceTotal", "gstPct", "otherCharges", "otherChargesTaxed", "items"],
};

const PROMPT = `This is one Indian bill, quotation, or Bill of Quantities (BOQ) — either a single photo, or a sequence of page images in reading order from one PDF. Read it and return the goods/services only.

Rules:
- If more than one page image is given, treat them as one continuous document — merge every goods/services row from every page into a single "items" array. A multi-section BOQ (e.g. a "supply of equipment" annexure followed by a separate "installation/labour" annexure) is still one document: include line items from every section.
- "items" is ONLY the goods/materials/service rows from the main tables. Never include CGST, SGST, IGST, tax-summary rows, "Rounding Off", "Taxable Value", section subtotals (e.g. "SUB GROUP", "Basic Price For ..."), or the printed grand total as an item.
- Freight, packing, cartage, transport, or loading charges are real charges but are NOT goods — put their amount in "otherCharges", not in "items".
- Bills treat freight two different ways, so read this one carefully and set "otherChargesTaxed" accordingly. If the freight row has its own HSN/SAC code and GST rate (e.g. "Freight (GST) 996511 18 %"), or the tax summary's total taxable value equals the goods subtotal PLUS the freight, then GST is charged on the freight — set it true. If freight is just a plain line with no HSN and no rate, and the taxable value equals the goods subtotal alone, set it false.
- If a row's quantity is split across two lines (e.g. "150.00 Mtr" on one line, "2 Bundal" as a note below), use the actual quantity/unit columns, not the note.
- invoiceTotal is the final amount actually payable across the WHOLE document — if there are several sections each with their own subtotal, use the single combined bottom-line total (e.g. "TOTAL A + B", "Grand Total"), not any one section's subtotal.
- vendor is the company issuing the document (the letterhead at the top), never the "Buyer" / "Bill to" / "Project" name.
- If you can't read a field confidently, make your best reasonable estimate — the user reviews and corrects every field before saving, so a best guess is far more useful than an empty value.`;

function errorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse("POST only", 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return errorResponse("Server is not configured with a Gemini API key.", 500);

  let body: { images?: { imageBase64?: string; mimeType?: string }[] };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Expected JSON body with an images array.", 400);
  }
  const images = body.images ?? [];
  if (
    images.length === 0 ||
    images.some((im) => !im.imageBase64 || !im.mimeType)
  ) {
    return errorResponse("Missing images, or an image is missing imageBase64/mimeType.", 400);
  }

  let upstream: Response;
  try {
    upstream = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
        "Api-Revision": "2026-05-20",
      },
      body: JSON.stringify({
        model: MODEL,
        input: [
          { type: "text", text: PROMPT },
          ...images.map((im) => ({ type: "image", data: im.imageBase64, mime_type: im.mimeType })),
        ],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: RESPONSE_SCHEMA,
        },
      }),
    });
  } catch (err) {
    return errorResponse(`Could not reach Gemini: ${err instanceof Error ? err.message : String(err)}`, 502);
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return errorResponse(`Gemini error ${upstream.status}: ${detail.slice(0, 500)}`, 502);
  }

  const data = await upstream.json();
  // `output_text` is the documented convenience accessor for the last text
  // block; fall back to walking `steps` in case a future response shape
  // stops populating it for structured-output requests.
  let text: string | undefined = data.output_text;
  if (!text && Array.isArray(data.steps)) {
    for (const step of data.steps) {
      const blocks = step?.content ?? step?.output ?? [];
      for (const block of Array.isArray(blocks) ? blocks : []) {
        if (typeof block?.text === "string") text = block.text;
      }
    }
  }
  if (!text) return errorResponse("Gemini returned no readable output.", 502);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return errorResponse("Gemini's response wasn't valid JSON.", 502);
  }

  return new Response(JSON.stringify(parsed), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
});
