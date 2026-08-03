// Reads a photographed Indian bill with Gemini vision and returns structured
// line items. This replaces on-device OCR (Tesseract) as the primary path when
// the phone is online — Tesseract stays as the offline fallback (see
// src/lib/geminiScan.ts). GEMINI_API_KEY is a Supabase Edge Function secret; it
// is never sent to the client.
//
// It reads two kinds of paper, because vendors in this trade hand over both:
// a printed GST tax invoice, and a handwritten "kaccha" bill torn from a
// notebook — Hindi, no GSTIN, no letterhead. The kaccha kind usually carries
// something a printed invoice never does: what was actually PAID against the
// bill and what is still owed. That makes one sheet of paper both a bill and a
// payment, so both are read here and the caller decides where each half lands.
// (scan-note stays separate: it reads a slip that is ONLY a payment, with no
// itemisation at all.)
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
    vendor: { type: "string", description: "The selling company's name (the printed letterhead), not the buyer's name. Empty string when the paper doesn't name the seller." },
    invoiceNo: { type: "string" },
    date: { type: "string", description: "ISO date YYYY-MM-DD. Bills often print it as '25-Jul-26' or '23-05-2026'." },
    invoiceTotal: { type: "number", description: "The final amount actually payable (the grand total row), not a mid-table subtotal." },
    gstPct: { type: "number", description: "The overall GST slab for the bill (5, 12, 18 or 28). If CGST+SGST are printed as two 9% rows, report 18, not 9. 0 when the bill charges no tax at all, as a handwritten kaccha bill usually doesn't." },
    isInformal: { type: "boolean", description: "True for a handwritten / kaccha / non-GST paper — a notebook page, a plain cash memo, anything with no GSTIN and no printed tax breakdown. False for a proper printed tax invoice." },
    paidAmount: { type: "number", description: "Money actually handed over against this bill, when the paper records it. 0 if no payment is written." },
    balanceDue: { type: "number", description: "What is still owed after that payment, when the paper records it. 0 if none is written." },
    paymentDate: { type: "string", description: "ISO date YYYY-MM-DD of the payment, when it is written and differs from the bill's own date. Empty string otherwise." },
    otherCharges: { type: "number", description: "Freight, packing, cartage or loading charges — paid, but not goods. 0 if none are printed." },
    otherChargesTaxed: { type: "boolean", description: "True only if GST is charged ON the freight — i.e. the freight row carries its own HSN/SAC code and rate (e.g. 'Freight (GST) 996511 18 %'), or the tax summary's taxable value includes the freight amount. False when freight is a plain add-on with no HSN and no rate." },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          item: { type: "string", description: "Product name only, in ENGLISH — no serial number, HSN code, or GST %." },
          qty: { type: "number" },
          unit: { type: "string", description: "As printed: pcs, Mtr, kg, bag, cft, ft, etc." },
          rate: { type: "number" },
          amount: { type: "number" },
        },
        required: ["item", "qty", "unit", "rate", "amount"],
      },
    },
  },
  required: [
    "vendor", "invoiceNo", "date", "invoiceTotal", "gstPct", "otherCharges",
    "otherChargesTaxed", "isInformal", "paidAmount", "balanceDue", "paymentDate", "items",
  ],
};

const PROMPT = `This is one Indian bill, quotation, or Bill of Quantities (BOQ) — either a single photo, or a sequence of page images in reading order from one PDF. It is EITHER a printed GST tax invoice, OR a handwritten "kaccha" bill from a vendor's notebook: Hindi (Devanagari) or Hinglish, no GSTIN, no letterhead, no printed invoice number, often a running account for one customer. Read both kinds the same way.

Rules:
- If more than one page image is given, treat them as one continuous document — merge every goods/services row from every page into a single "items" array. A multi-section BOQ (e.g. a "supply of equipment" annexure followed by a separate "installation/labour" annexure) is still one document: include line items from every section.
- "items" is ONLY the goods/materials/service rows from the main tables. Never include CGST, SGST, IGST, tax-summary rows, "Rounding Off", "Taxable Value", section subtotals (e.g. "SUB GROUP", "Basic Price For ..."), or the printed grand total as an item.
- Freight, packing, cartage, transport, or loading charges are real charges but are NOT goods — put their amount in "otherCharges", not in "items".
- Bills treat freight two different ways, so read this one carefully and set "otherChargesTaxed" accordingly. If the freight row has its own HSN/SAC code and GST rate (e.g. "Freight (GST) 996511 18 %"), or the tax summary's total taxable value equals the goods subtotal PLUS the freight, then GST is charged on the freight — set it true. If freight is just a plain line with no HSN and no rate, and the taxable value equals the goods subtotal alone, set it false.
- If a row's quantity is split across two lines (e.g. "150.00 Mtr" on one line, "2 Bundal" as a note below), use the actual quantity/unit columns, not the note.
- invoiceTotal is the final amount actually payable across the WHOLE document — if there are several sections each with their own subtotal, use the single combined bottom-line total (e.g. "TOTAL A + B", "Grand Total"), not any one section's subtotal.
- vendor is the company issuing the document (the letterhead at the top), never the "Buyer" / "Bill to" / "Project" name. On a handwritten notebook bill the name written at the top is usually the CUSTOMER whose account is being kept, not the seller — when the seller is not named anywhere, return an EMPTY vendor. Never invent a plausible shop name like "Hardware Store", and never fall back to the customer's name.

Handwritten (kaccha) bills — read these carefully, they are half the papers in this trade:
- Indian handwriting is DAY-first: "18/07/26" is 18 July 2026 and "21/7/26" is 21 July 2026, never February or May.
- Indian digit grouping is lakh-based: "1,00,000" is 100000 and "1,11,160" is 111160. Never read "1,00,000" as 1000.
- Devanagari numerals ० १ २ ३ ४ ५ ६ ७ ८ ९ map to 0-9.
- A row often reads "<qty> <item> <size> <amount>" with NO rate column. Derive rate = amount / qty in that case.
- Set "isInformal" true for any such paper, and "gstPct" to 0 — these bills carry no tax.
- भाड़ा / ढुलाई (bhada / dhulai) is freight: it belongs in "otherCharges", not in "items", exactly like a printed freight row. It is never taxed on a kaccha bill.
- A note like "15+8 गये" or "7+1 गयी" next to a row is the vendor recording how the quantity was delivered in parts. The quantity column on the left is still the real quantity — do not add these up or substitute them.
- The same column may mix Devanagari and Latin digits (२३ = 23, ४ = 4, २५० = 250, ४०० = 400). Read both.

The quantity column, on a ticked bill — the single most common misread, so do this deliberately:
- Vendors TICK each delivered row with a check mark (✓, L, ⌐, or a hook) drawn immediately to the LEFT of the quantity. It is not a digit.
- That tick's upstroke frequently TOUCHES the first digit and fuses with it. A tick + "1" looks exactly like a "4"; a tick + "0" looks like a "6". So a written "10" reads as "40", and "18" reads as "48". This is the error to avoid.
- Read the quantity column as a COLUMN, top to bottom, not row by row. The real digits line up vertically with each other; the tick marks sit to their left, outside that alignment. Use that alignment to decide where the tick ends and the number begins.
- Before answering, re-check every quantity that begins with 4 or 6. If the row is ticked and the leading stroke touches what follows, the 4 is a tick plus a 1, and the 6 is a tick plus a 0.
- Then sanity-check each derived rate against the rows around it: on one bill a bigger version of a part costs MORE than a smaller one, and a moulded fitting (trap, bend) is never cheaper than a plain socket or washer. A rate that sits far below its neighbours means the QUANTITY was read too high — go back and re-read that row's quantity.

Item names must be in ENGLISH. Translate or transliterate Hindi product names, keeping the size/spec exactly as written ('4"', '6x4', '6Kg'):
पाइप Pipe · एलबो Elbow · टी Tee · सॉकेट/सोकिट Socket · नहनी ट्रैप Nahani trap · पी ट्रैप P-trap · चैनल Channel · फासनर Fastener · वाशर Washer · नट Nut · सिलिकॉन Silicone · फ्लैंज Flange · सीमेंट Cement · ईंट/ईट Brick · बालू/रेत Sand · गिट्टी Aggregate · सरिया Steel rod · लकड़ी Wood · टाइल्स Tiles · पेंट Paint · तार Wire · नल Tap · पत्थर Stone.
Where a quantity is written in feet (फिट / feet / ft), the unit is "ft", not "pcs".

Payment and balance — a handwritten running account usually records what was actually PAID against the bill, which a printed invoice never does:
- Hindi markers: जमा (jama) = deposited/paid · शेष / बाकी / बकाया = balance still due · कुल / Total = the bill's own total · पिछला / पुराना = previous or old dues.
- "paidAmount" is the money actually handed over against this bill. "balanceDue" is what is still owed. Both 0 when the paper records no payment.
- "paymentDate" is the date written beside the payment when it differs from the bill's date — a bill dated 18/07 can carry a payment noted 21/7/26.
- These figures are NOT goods and NOT the bill total. Never put them in "items", and never let them change "invoiceTotal" — invoiceTotal stays the bill's own total (goods + freight), even when only part of it has been paid.
- If you can't read a field confidently, make your best reasonable estimate — the user reviews and corrects every field before saving, so a best guess is far more useful than an empty value. The one exception is "vendor": leave it empty rather than guess a name.`;

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
