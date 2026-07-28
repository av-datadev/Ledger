// Reads a HANDWRITTEN note with Gemini vision and returns one draft ledger
// entry. This is the informal counterpart to `scan-bill`: that function reads a
// printed GST tax invoice into structured line items, while this one reads the
// things that never come as a proper invoice — a vendor's kaccha slip, a
// cheque, a Hindi diary page, a labour-payment note torn off a notebook.
//
// Those carry no HSN codes, no invoice number and usually no tax table, so a
// separate prompt + schema is far more accurate than bending the bill reader.
// The output maps onto a ledger Entry (date / description / amount / mode),
// NOT onto BOQ line items.
//
// GEMINI_API_KEY is a Supabase Edge Function secret; never sent to the client.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL = "gemini-3.6-flash";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    date: {
      type: "string",
      description:
        "ISO date YYYY-MM-DD. Indian handwriting is DAY-first: '5/7/26' is 5 July 2026, never 7 May. Empty string if no date is written.",
    },
    description: {
      type: "string",
      description:
        "Short English description of what the payment was for, e.g. 'Payment for cement' or 'Labour payment'. Translate Hindi into English here.",
    },
    detail: {
      type: "string",
      description:
        "The vendor / shop / person paid, as written (transliterate Devanagari names into Latin script, e.g. 'किसान ट्रेडर्स' becomes 'Kisan Traders'). Empty if not named.",
    },
    amount: {
      type: "number",
      description:
        "The final amount paid, in rupees, as a plain number (150000, not '1,50,000').",
    },
    amountInWords: {
      type: "string",
      description:
        "Any amount written in words, verbatim as written ('Fifty thousand only', 'पचास हज़ार'). Empty if none. Used so the person can double-check the digits.",
    },
    mode: {
      type: "string",
      description:
        "One of exactly: Cash, Cheque, UPI, Bank transfer, or empty string if not stated. A cheque number or bank name printed on the paper implies Cheque.",
    },
    notes: {
      type: "string",
      description:
        "Anything else worth keeping: cheque number, bank name, balance/pending amount noted on the slip, phone number. Empty if none.",
    },
    originalText: {
      type: "string",
      description:
        "Verbatim transcription of everything written on the paper, preserving the original script (keep Devanagari as Devanagari). This is shown to the person so they can check the reading against the photo.",
    },
    isInformal: {
      type: "boolean",
      description:
        "True when this is an informal/handwritten paper — a kaccha slip, diary page, plain cash memo, or anything with no GST number and no printed tax breakdown. False only for a proper printed tax invoice.",
    },
    confidence: {
      type: "string",
      description:
        "'high' if the handwriting is clear and the amount is unambiguous; 'medium' if mostly readable; 'low' if the amount or key fields are a genuine guess.",
    },
  },
  required: [
    "date",
    "description",
    "detail",
    "amount",
    "amountInWords",
    "mode",
    "notes",
    "originalText",
    "isInformal",
    "confidence",
  ],
};

const PROMPT = `You are reading a photo of a HANDWRITTEN payment record from an Indian house-construction project. It could be a vendor's informal "kaccha" slip or cash memo, a cheque, a page from a site diary, or a scribbled labour-payment note. It may be in English, Hindi (Devanagari), or Hinglish, and the handwriting may be poor.

Return ONE payment as structured fields.

Reading the amount — this matters more than everything else, so work through it carefully:
- Indian digit grouping uses lakhs, not thousands: "1,50,000" is 150000. "12,00,000" is 1200000. Never read "1,50,000" as 1500 or as 150.
- Indian number words: "hazar" / "हज़ार" / "hzr" = thousand; "lakh" / "लाख" / "lac" = 100000; "crore" / "करोड़" = 10000000. So "50 hazar" = 50000, "1.5 lakh" = 150000, "2 lac 25 hazar" = 225000.
- Devanagari numerals ० १ २ ३ ४ ५ ६ ७ ८ ९ map to 0-9.
- "/-" or "Rs" or "₹" or "रु" just mark the figure as rupees — strip them.
- On a CHEQUE, the amount written in words is the legally authoritative one. If the words and the digits disagree, use the WORDS for "amount" and say so in "notes".
- If several figures appear, the amount PAID is what goes in "amount". A running balance, a previous-due figure, or a total-to-date is NOT the payment — put those in "notes" instead.

Reading the date:
- Indian handwriting is day-first. "5/7/26" is 5 July 2026. "12-3-26" is 12 March 2026. Never interpret these as month-first.
- A two-digit year like "26" means 2026.
- If no date is written at all, return an empty string — do not invent today's date.

Common Hindi construction vocabulary you will meet (translate the description into English):
सीमेंट cement · ईंट / ईट brick · बालू / रेत sand · गिट्टी aggregate · सरिया steel rods · मजदूरी / मजूरी labour wages · ठेकेदार contractor · मिस्त्री mason · पेंट paint · टाइल्स tiles · लकड़ी wood · बिजली electrical · प्लंबिंग / नल plumbing · भाड़ा / ढुलाई freight or cartage · एडवांस / पेशगी advance · जमा deposited · बाकी / बकाया balance due · कुल total · दिनांक date.

Other rules:
- "description" must be in English even when the paper is in Hindi. Put the untouched original in "originalText".
- Transliterate people's and shops' names into Latin script for "detail" (किसान ट्रेडर्स becomes "Kisan Traders"), but keep them recognisable — do not translate a name into its English meaning.
- Set "isInformal" true for any handwritten or non-GST paper. Many vendors in this trade hand over a plain slip with no GST number; that is exactly what this reader is for, and flagging it lets the person see later which payments have no formal tax invoice behind them.
- If you genuinely cannot read the amount, return 0 and set "confidence" to "low" rather than inventing a figure. For every other field, a sensible best guess beats an empty value — the person reviews and corrects everything before saving.`;

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
  if (images.length === 0 || images.some((im) => !im.imageBase64 || !im.mimeType)) {
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
    return errorResponse(
      `Could not reach Gemini: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return errorResponse(`Gemini error ${upstream.status}: ${detail.slice(0, 500)}`, 502);
  }

  const data = await upstream.json();
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
