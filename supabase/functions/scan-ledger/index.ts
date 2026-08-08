// Reads a whole EXPENSE HISTORY out of free-form text and returns many ledger
// entries. This is the fourth reader, and unlike the other three it takes text
// rather than an image.
//
// It exists for the migration problem: someone has been keeping their spend in
// a phone note, a WhatsApp thread to themselves, or a spreadsheet nobody would
// call tidy, and none of that is going to be retyped by hand one line at a
// time. The other readers all handle ONE document producing ONE record —
// scan-bill a bill, scan-note a payment, scan-sizes a size list. This one turns
// a hundred scribbled lines into a hundred entries in a single pass.
//
//     12/3 cement 4500 cash
//     15/3 - paid mistri 8000
//     18-3-26 sariya 12 quintal 62,000 cheque SBI
//     20/3 बालू 3500 नकद
//
// The client only sends text here when its own deterministic parser could not
// do the job (see importParse.ts): a spreadsheet with real headers is mapped on
// the phone and never reaches this function. That split is the point — a
// person's entire financial history should only leave their device when there
// is no other way to read it.
//
// GEMINI_API_KEY is a Supabase Edge Function secret; never sent to the client.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL = "gemini-3.6-flash";

// A hand-kept history is long. Cap what one call will look at so a pasted novel
// can't run the function out of time — the client chunks anything bigger.
const MAX_CHARS = 60_000;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      description:
        "One object per expense found, in the order they appear in the text. Return an empty array if the text holds no expenses at all.",
      items: {
        type: "object",
        properties: {
          date: {
            type: "string",
            description:
              "ISO date YYYY-MM-DD. Indian writing is DAY-first: '5/7/26' is 5 July 2026, never 7 May. Empty string when the line carries no date and none can be carried down from a heading above it.",
          },
          event: {
            type: "string",
            description:
              "Short English description of what the money was for ('Cement', 'Mason wages', 'Tile advance'). Translate Hindi here; keep it to a few words.",
          },
          detail: {
            type: "string",
            description:
              "The shop, vendor or person paid, transliterated into Latin script ('किसान ट्रेडर्स' becomes 'Kisan Traders'). Empty when not named.",
          },
          amount: {
            type: "number",
            description:
              "Amount in rupees as a plain number (150000, not '1,50,000'). Use 0 only when the line genuinely states no figure.",
          },
          mode: {
            type: "string",
            description:
              "One of exactly: Cash, Cheque, UPI, Bank transfer — or an empty string when the line doesn't say.",
          },
          paidBy: {
            type: "string",
            description:
              "Who paid, when the text names a person or an account ('Papa', 'SBI 8101'). Empty when not stated.",
          },
          category: {
            type: "string",
            description:
              "Best-fit spending category in English ('Wood', 'Electrical', 'Paint', 'Plumbing', 'Tiles', 'Marble', 'Site Prep', 'Labour', 'Misc'). Empty if genuinely unclear.",
          },
          notes: {
            type: "string",
            description:
              "Anything else on the line worth keeping — a cheque number, a quantity, a running balance. Empty if none.",
          },
          raw: {
            type: "string",
            description:
              "The source line copied verbatim, exactly as it appears in the input. Shown beside the parsed fields so the person can check the reading.",
          },
        },
        required: ["date", "event", "detail", "amount", "mode", "paidBy", "category", "notes", "raw"],
      },
    },
    confidence: {
      type: "string",
      description:
        "'high' when the text is a clean list and nearly every line parsed cleanly; 'medium' when mostly readable; 'low' when the format is inconsistent enough that amounts or dates are guesses.",
    },
    warning: {
      type: "string",
      description:
        "One short sentence naming anything the person should check — e.g. 'Several lines had no year, so 2026 was assumed' or 'Lines 40-52 look like a running balance rather than payments'. Empty when there is nothing to flag.",
    },
  },
  required: ["entries", "confidence", "warning"],
};

const PROMPT = `You are reading someone's personal record of construction spending and turning it into ledger entries. The text was kept for themselves, not for anyone else to read: a phone note, messages to themselves, or a spreadsheet pasted as text. Expect no consistent format.

Return EVERY expense you find, one object per payment, in the order written.

Reading the amounts — this matters more than anything else here:
- Indian digit grouping is lakh-based: "1,50,000" is 150000. "12,00,000" is 1200000. Never read "1,50,000" as 1500.
- Indian number words: "hazar"/"हज़ार"/"hzr"/"k" = thousand; "lakh"/"लाख"/"lac" = 100000; "crore"/"करोड़" = 10000000. So "50 hazar" is 50000, "1.5 lakh" is 150000, "2 lac 25 hazar" is 225000.
- Devanagari numerals ० १ २ ३ ४ ५ ६ ७ ८ ९ map to 0-9.
- "/-", "Rs", "₹", "रु" only mark the figure as rupees — strip them.
- A quantity is not an amount. In "sariya 12 quintal 62,000" the amount is 62000 and the 12 quintal belongs in notes.

Reading the dates:
- DAY-first, always. "5/7/26" is 5 July 2026. "12-3" is 12 March.
- A note often writes the date once as a heading and then lists several payments under it. Carry that date down onto each of those lines.
- When a line has a day and month but no year, infer the year from the surrounding lines. If the whole text has no year anywhere, leave the date empty rather than inventing one — the person is shown these and can set it.
- Never output today's date as a guess for a line that has no date.

What is NOT an expense — leave these out entirely:
- A running total, a subtotal, or a "grand total" line.
- A balance carried forward, an amount still owed, or a budget/estimate for future work.
- Money RECEIVED rather than paid, unless the text is clearly a list of payments made.
- Headings, column names, and the person's own notes to themselves that carry no figure.
Getting this wrong is worse than missing a row: a total counted as an expense doubles a month.

Other rules:
- "event" must be English even when the source is Hindi or Hinglish. Put the untouched original in "raw".
- Transliterate names rather than translating them: किसान ट्रेडर्स is "Kisan Traders", not "Farmer Traders".
- Common vocabulary: सीमेंट cement · ईंट brick · बालू/रेत sand · गिट्टी aggregate · सरिया steel · मजदूरी labour · ठेकेदार contractor · मिस्त्री mason · पेंट paint · टाइल्स tiles · लकड़ी wood · बिजली electrical · नल plumbing · भाड़ा cartage · एडवांस advance · नकद cash · जमा deposited · बाकी balance.
- If one line records several separate payments, split it into several entries.
- Every entry needs its "raw" line filled in. The person reviews all of this against the original before anything is saved, so a best guess with the source line beside it is far more useful than a dropped row.`;

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

  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Expected JSON body with a text field.", 400);
  }
  const text = (body.text ?? "").trim();
  if (!text) return errorResponse("No text to read.", 400);
  if (text.length > MAX_CHARS) {
    return errorResponse(
      `That's ${text.length} characters; this reads up to ${MAX_CHARS} at a time.`,
      413,
    );
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
          { type: "text", text: `Here is the text to read:\n\n${text}` },
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
  let out: string | undefined = data.output_text;
  if (!out && Array.isArray(data.steps)) {
    for (const step of data.steps) {
      const blocks = step?.content ?? step?.output ?? [];
      for (const block of Array.isArray(blocks) ? blocks : []) {
        if (typeof block?.text === "string") out = block.text;
      }
    }
  }
  if (!out) return errorResponse("Gemini returned no readable output.", 502);

  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    return errorResponse("Gemini's response wasn't valid JSON.", 502);
  }

  return new Response(JSON.stringify(parsed), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
});
