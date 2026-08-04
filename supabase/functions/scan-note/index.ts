// Reads a HANDWRITTEN note with Gemini vision and returns one draft ledger
// entry. This is the informal counterpart to `scan-bill`: that function reads a
// printed GST tax invoice into structured line items, while this one reads the
// things that never come as a proper invoice — a vendor's kaccha slip, a
// cheque, a Hindi diary page, a labour-payment note torn off a notebook.
//
// Those carry no HSN codes, no invoice number and usually no tax table, so a
// separate prompt + schema is far more accurate than bending the bill reader.
// The output maps onto a ledger Entry (date / description / amount / mode).
//
// It also reports whether the paper is a BILL as well as a payment — a vendor's
// running account is an itemised table of goods with what was handed over
// written underneath, and reading only the money silently threw the whole table
// away. When there are goods rows they come back in `items`, and the entry form
// asks the person whether the paper belongs in the ledger, the BOQ, or both,
// rather than deciding for them.
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
    // A kaccha slip is often BOTH a bill and a payment on one sheet: an itemised
    // table of goods, with what was handed over written underneath. Reading only
    // the payment threw the whole table away and silently turned a bill into a
    // ledger line, so the goods rows come back too and the caller asks the
    // person where the paper should land.
    isItemisedBill: {
      type: "boolean",
      description:
        "True when the paper lists individual goods/materials rows (a quantity + item + amount table), i.e. it is a BILL and not only a payment record. False for a plain cheque, a labour-payment note, or a slip that records only money with no itemisation.",
    },
    billTotal: {
      type: "number",
      description:
        "The bill's own grand total (goods + freight) when the paper has an itemised table. This is NOT the amount paid. 0 when there is no itemised table.",
    },
    balanceDue: {
      type: "number",
      description:
        "What is still owed after the payment, when the paper records it (शेष / बाकी / बकाया). 0 if none is written.",
    },
    otherCharges: {
      type: "number",
      description:
        "Freight or cartage (भाड़ा / ढुलाई) — a real charge but not goods. 0 if none.",
    },
    items: {
      type: "array",
      description:
        "The goods/materials rows, when the paper has an itemised table. Empty array for a plain payment record.",
      items: {
        type: "object",
        properties: {
          item: {
            type: "string",
            description:
              "Product name in ENGLISH, keeping the size/spec exactly as written ('4\"', '6x4', '6Kg').",
          },
          qty: { type: "number" },
          unit: { type: "string", description: "pcs, ft, kg, bag, cft, etc." },
          rate: { type: "number" },
          amount: { type: "number" },
        },
        required: ["item", "qty", "unit", "rate", "amount"],
      },
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
    "isItemisedBill",
    "billTotal",
    "balanceDue",
    "otherCharges",
    "items",
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
- If you genuinely cannot read the amount, return 0 and set "confidence" to "low" rather than inventing a figure. For every other field, a sensible best guess beats an empty value — the person reviews and corrects everything before saving.

Is this paper a BILL as well as a payment? Decide this deliberately — it changes where the paper is filed:
- Many kaccha slips are a vendor's running account: an itemised table of goods down the page, then what was handed over written at the bottom. That sheet is BOTH a bill and a payment.
- Set "isItemisedBill" true when there is a table of goods rows (quantity + item + amount). Set it false for a cheque, a labour-payment note, an advance, or any slip that records only money.
- When it is true, fill "items" with EVERY goods row, put the sheet's own grand total in "billTotal", freight in "otherCharges", and what is still owed in "balanceDue". "amount" stays the money actually HANDED OVER (जमा), which on a part-paid bill is less than "billTotal".
- When it is false, return an empty "items" array and 0 for "billTotal" / "otherCharges".

Reading an itemised kaccha table, when there is one:
- A row often reads "<qty> <item> <size> <amount>" with NO rate column. Derive rate = amount / qty.
- भाड़ा / ढुलाई is freight: it goes in "otherCharges", never in "items". Never put the total, the जमा line, or the शेष line in "items" either.
- Vendors TICK each delivered row with a check mark (✓, L, ⌐, or a hook) drawn immediately to the LEFT of the quantity. It is not a digit. That tick frequently TOUCHES the first digit and fuses with it: a tick + "1" looks exactly like a "4", and a tick + "0" looks like a "6", so a written "10" reads as "40" and "18" as "48". Read the quantity column as a COLUMN, top to bottom — the real digits line up vertically and the ticks sit outside that alignment. Re-check every quantity beginning with 4 or 6 before answering.
- Sanity-check each derived rate against its neighbours: a bigger version of a part costs MORE than a smaller one, and a moulded fitting (trap, bend) is never cheaper than a plain socket or washer. A rate far below its neighbours means the quantity was read too high — re-read that row.
- Item names in ENGLISH, size kept as written: पाइप Pipe · एलबो Elbow · टी Tee · सॉकेट/सोकिट Socket · नहनी ट्रैप Nahani trap · पी ट्रैप P-trap · चैनल Channel · फासनर Fastener · वाशर Washer · नट Nut · सिलिकॉन Silicone · फ्लैंज Flange · सीमेंट Cement · ईंट/ईट Brick · बालू/रेत Sand · गिट्टी Aggregate · सरिया Steel rod · लकड़ी Wood · टाइल्स Tiles · पेंट Paint · तार Wire · नल Tap · पत्थर Stone.
- Where a quantity is written in feet (फिट / feet / ft), the unit is "ft", not "pcs".`;

function errorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Same shape as scan-bill's retry (see that file for the reasoning). It matters
// more here, if anything: this reader has NO on-device fallback at all, so a
// transient rate limit means the person retypes the slip by hand.
const MAX_ATTEMPTS = 3;
const TOTAL_BUDGET_MS = 100_000;
const SLOWEST_ATTEMPT_MS = 35_000;
const MAX_BACKOFF_MS = 20_000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const backoffMs = (attempt: number) =>
  Math.min(2_000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);

/** Google puts the wait it wants in a RetryInfo detail and names the exhausted
 * quota in a QuotaFailure detail — that quota id is the only place the
 * per-minute and per-day limits are told apart. */
function readUpstreamFailure(
  status: number,
  body: string,
  retryAfter: string | null,
): { retryDelayMs: number | null; dailyQuota: boolean; retryable: boolean } {
  let retryDelayMs: number | null = null;
  let dailyQuota = false;
  try {
    const details = JSON.parse(body)?.error?.details;
    for (const detail of Array.isArray(details) ? details : []) {
      if (typeof detail?.retryDelay === "string") {
        const secs = parseFloat(detail.retryDelay);
        if (Number.isFinite(secs)) retryDelayMs = secs * 1000;
      }
      for (const v of Array.isArray(detail?.violations) ? detail.violations : []) {
        if (/per_?day/i.test(`${v?.quotaId ?? ""} ${v?.quotaMetric ?? ""}`)) {
          dailyQuota = true;
        }
      }
    }
  } catch {
    // Not JSON — fall back to the header below.
  }
  if (retryDelayMs == null && retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs)) retryDelayMs = secs * 1000;
  }
  return {
    retryDelayMs,
    dailyQuota,
    retryable: RETRYABLE_STATUS.has(status) && !dailyQuota,
  };
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

  const geminiBody = JSON.stringify({
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
  });

  const startedAt = Date.now();
  let upstream: Response | null = null;
  let lastStatus = 0;
  let lastDetail = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(GEMINI_URL, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
          "Api-Revision": "2026-05-20",
        },
        body: geminiBody,
      });
    } catch (err) {
      lastStatus = 0;
      lastDetail = `Could not reach Gemini: ${err instanceof Error ? err.message : String(err)}`;
      const wait = backoffMs(attempt);
      if (
        attempt === MAX_ATTEMPTS ||
        Date.now() - startedAt + wait + SLOWEST_ATTEMPT_MS > TOTAL_BUDGET_MS
      ) break;
      await sleep(wait);
      continue;
    }

    if (response.ok) {
      upstream = response;
      break;
    }

    lastStatus = response.status;
    lastDetail = await response.text().catch(() => "");
    const { retryDelayMs, dailyQuota, retryable } = readUpstreamFailure(
      response.status,
      lastDetail,
      response.headers.get("retry-after"),
    );

    if (dailyQuota) {
      return errorResponse("The AI reader's daily quota is used up. It resets tomorrow.", 429);
    }
    if (!retryable) break;

    const wait = Math.min(retryDelayMs ?? backoffMs(attempt), MAX_BACKOFF_MS);
    if (
      attempt === MAX_ATTEMPTS ||
      Date.now() - startedAt + wait + SLOWEST_ATTEMPT_MS > TOTAL_BUDGET_MS
    ) break;
    await sleep(wait);
  }

  if (!upstream) {
    if (RETRYABLE_STATUS.has(lastStatus)) {
      return errorResponse("The AI reader is busy right now. Try again in a moment.", 503);
    }
    return errorResponse(
      lastStatus ? `Gemini error ${lastStatus}: ${lastDetail.slice(0, 500)}` : lastDetail,
      502,
    );
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
