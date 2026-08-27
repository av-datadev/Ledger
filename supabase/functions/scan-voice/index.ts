// Turns a SPOKEN sentence into a draft record, in Hindi, Hinglish or English.
//
// The sibling of `scan-note`, which reads a photographed slip. This reads
// speech, and exists for the same reason the app is worth having at all: the
// people who hold these books do not want to fill in a form on a phone. A
// contractor saying "do hazaar ka cement Gopal se liya" is doing in three
// seconds what the Entry screen asks eight taps for.
//
// It transcribes AND extracts. Plain transcription would leave a sentence that
// still has to be typed into fields; what makes this worth the round trip is
// that the fields come back filled. The person always reviews before saving —
// nothing here writes to the ledger.
//
// Three shapes, because the app records three different kinds of thing and a
// single loose schema would guess wrong at the one that matters:
//   entry — a ledger payment            (Entry tab)
//   stock — a material handed out/in    (Stock tab)
//   site  — a contractor's money-log row (contractor site screen)
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

// Shared by all three shapes. `transcript` is not decoration: it is how a
// person checks the machine heard them, and the only way to tell "it misheard
// the number" apart from "it misunderstood the sentence".
const COMMON_FIELDS = {
  transcript: {
    type: "string",
    description:
      "Verbatim transcription of what was said, in the ORIGINAL language and script. Do not translate this field. Devanagari stays Devanagari; Hinglish stays Hinglish.",
  },
  confidence: {
    type: "string",
    description: "One of: high, medium, low. Use low when the audio was unclear or the amount uncertain.",
  },
  unclear: {
    type: "string",
    description:
      "If something important could not be made out, name it in plain English ('could not hear the amount'). Empty string when the sentence was clear.",
  },
};

const AMOUNT_RULES = `Reading amounts — this matters more than anything else:
- Indian number words: "hazar"/"hazaar"/"हज़ार" = thousand; "lakh"/"lac"/"लाख" = 100000; "crore"/"करोड़" = 10000000.
- So "do hazaar" = 2000, "dhai hazaar" = 2500, "sava lakh" = 125000, "paune do lakh" = 175000, "dedh lakh" = 150000.
- Hindi numerals spoken: ek 1, do 2, teen 3, chaar 4, paanch 5, chhe 6, saat 7, aath 8, nau 9, das 10, bees 20, pachas 50, sau 100.
- Fractions people actually say: "sava" = +1/4, "dedh" = 1.5, "dhai" = 2.5, "paune" = -1/4, "saadhe" = +1/2. "saadhe teen hazaar" = 3500.
- If the amount is genuinely unclear, return 0 and say so in "unclear" rather than inventing a figure.`;

const VOCAB = `Hindi construction vocabulary you will meet:
सीमेंट cement · ईंट/ईट brick · बालू/रेत sand · गिट्टी aggregate · सरिया steel rod · मजदूरी/मजूरी labour wages · ठेकेदार contractor · मिस्त्री mason · राजमिस्त्री bricklayer · प्लंबर plumber · बिजली वाला electrician · पेंटर painter · बढ़ई carpenter · पेंट paint · टाइल्स tiles · लकड़ी wood · नल/प्लंबिंग plumbing · भाड़ा/ढुलाई freight · एडवांस/पेशगी advance · जमा deposited · बाकी/बकाया balance due · दिया gave · लिया took/bought · खरीदा bought.`;

const DATE_RULES = `Dates:
- "aaj" = today, "kal" = yesterday OR tomorrow depending on tense (past tense means yesterday), "parso" = day before yesterday (past) or day after tomorrow (future).
- Relative words are resolved against TODAY'S DATE, given below.
- Spoken dates are day-first: "paanch tareekh" = the 5th of the current month.
- If no date is spoken at all, return today's date.`;

const SCHEMAS: Record<string, { schema: unknown; prompt: string }> = {
  entry: {
    schema: {
      type: "object",
      properties: {
        ...COMMON_FIELDS,
        date: { type: "string", description: "ISO YYYY-MM-DD. Today's date if none was spoken." },
        description: {
          type: "string",
          description: "Short ENGLISH description of what the money was for, e.g. 'Cement' or 'Labour payment'.",
        },
        detail: {
          type: "string",
          description:
            "The shop or person paid, transliterated into Latin script ('Gopal', 'Kisan Traders'). Empty if nobody was named.",
        },
        amount: { type: "number", description: "Rupees, plain number. 0 if not spoken." },
        mode: {
          type: "string",
          description: "Exactly one of: Cash, Cheque, UPI, Bank transfer, or empty string if not stated.",
        },
        category: {
          type: "string",
          description:
            "Best-guess work category in English: Plumbing, Electrical, Wood, Paint, Tiles, Marble, Contractor, Labour, Misc. Empty string if genuinely unclear.",
        },
        notes: { type: "string", description: "Anything else said worth keeping. Empty if none." },
      },
      required: [
        "transcript", "confidence", "unclear",
        "date", "description", "detail", "amount", "mode", "category", "notes",
      ],
    },
    prompt: `You are listening to somebody recording ONE PAYMENT for an Indian house-construction ledger. They may speak Hindi, Hinglish or English, often mixing them in one sentence ("do hazaar ka cement Gopal se liya").

Return the payment as structured fields.`,
  },

  stock: {
    schema: {
      type: "object",
      properties: {
        ...COMMON_FIELDS,
        date: { type: "string", description: "ISO YYYY-MM-DD. Today's date if none was spoken." },
        kind: {
          type: "string",
          description:
            "'out' when material was GIVEN to somebody (diya, de diye, gave, handed). 'in' when material was RECEIVED into store (aaya, liya, mila, received). Default to 'out'.",
        },
        item: {
          type: "string",
          description:
            "Material name in ENGLISH, keeping the size exactly as spoken ('T 1.5 inch', 'Elbow 3/4', 'Cement'). Sizes are usually said in inches.",
        },
        qty: { type: "number", description: "How many. 0 if not spoken." },
        unit: { type: "string", description: "pcs, bag, kg, ft, roll, L. Empty if not clear." },
        person: {
          type: "string",
          description:
            "Who it went to or came from, transliterated ('Plumber', 'Vijay', 'Rafi'). Empty if nobody was named.",
        },
      },
      required: [
        "transcript", "confidence", "unclear",
        "date", "kind", "item", "qty", "unit", "person",
      ],
    },
    prompt: `You are listening to somebody recording a MATERIAL MOVEMENT on an Indian construction site — material handed to a worker, or received into store. They may speak Hindi, Hinglish or English ("paanch T one inch plumber ko diye").

Sizes matter and are usually in inches — "one inch", "ek inch", "do inch", "teen bata chaar" (3/4), "aadha" (1/2), "dedh inch" (1.5). Keep the size in the item name exactly as spoken.

Return the movement as structured fields.`,
  },

  site: {
    schema: {
      type: "object",
      properties: {
        ...COMMON_FIELDS,
        date: { type: "string", description: "ISO YYYY-MM-DD. Today's date if none was spoken." },
        kind: {
          type: "string",
          description:
            "Exactly one of: received (money taken FROM the site owner), material (spent on materials), labour (paid to workers), other (any other spend). Default to 'other' when a spend is unclear.",
        },
        description: {
          type: "string",
          description: "Short ENGLISH description, e.g. 'Cement 20 bags' or 'Mistri 3 days'.",
        },
        amount: { type: "number", description: "Rupees, plain number. 0 if not spoken." },
        notes: { type: "string", description: "Anything else said worth keeping. Empty if none." },
      },
      required: [
        "transcript", "confidence", "unclear",
        "date", "kind", "description", "amount", "notes",
      ],
    },
    prompt: `You are listening to a CONTRACTOR recording one line of his own site money-log. They may speak Hindi, Hinglish or English ("aaj maalik se pachas hazaar liye" = received 50000 from the owner today).

Decide carefully whether money came IN from the owner or went OUT as a spend — that single distinction is what the whole running balance is built on.

Return the row as structured fields.`,
  },
};

function errorResponse(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Same retry shape as scan-bill / scan-note (see those files for the reasoning).
// It matters here too: there is no on-device fallback for speech, so a
// transient rate limit means the person types the whole thing by hand instead.
const MAX_ATTEMPTS = 3;
const TOTAL_BUDGET_MS = 100_000;
const SLOWEST_ATTEMPT_MS = 35_000;
const MAX_BACKOFF_MS = 20_000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const backoffMs = (attempt: number) =>
  Math.min(2_000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);

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
        if (/per_?day/i.test(`${v?.quotaId ?? ""} ${v?.quotaMetric ?? ""}`)) dailyQuota = true;
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

  let body: { audioBase64?: string; mimeType?: string; mode?: string; today?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Expected JSON body with audioBase64, mimeType and mode.", 400);
  }
  const { audioBase64, mimeType, mode = "entry" } = body;
  if (!audioBase64 || !mimeType) {
    return errorResponse("Missing audioBase64 or mimeType.", 400);
  }
  const shape = SCHEMAS[mode];
  if (!shape) return errorResponse(`Unknown mode "${mode}".`, 400);

  // Today comes from the DEVICE, not the server: relative words ("aaj", "kal")
  // must resolve in the speaker's own timezone, and an edge function runs in
  // UTC somewhere else entirely. A phone at 00:30 IST is still the previous
  // day in UTC, which would date every late-night entry one day early.
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today ?? "")
    ? body.today
    : new Date().toISOString().slice(0, 10);

  const prompt = `${shape.prompt}

TODAY'S DATE IS ${today}. Resolve every relative date against it.

${AMOUNT_RULES}

${DATE_RULES}

${VOCAB}

Rules that apply to every field:
- Descriptions and item names come back in ENGLISH even when the speech is Hindi. The untouched original goes in "transcript".
- Transliterate people's names into Latin script; do not translate them into their English meaning.
- A sensible best guess beats an empty field — the person reviews and corrects everything on screen before anything is saved. The one exception is the amount: never invent one.
- If the audio contains no record at all (silence, background noise, someone talking about something else), return zeros/empty strings, set confidence to "low", and say so in "unclear".`;

  const geminiBody = JSON.stringify({
    model: MODEL,
    input: [
      { type: "text", text: prompt },
      { type: "audio", data: audioBase64, mime_type: mimeType },
    ],
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: shape.schema,
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
      return errorResponse("The voice reader's daily quota is used up. It resets tomorrow.", 429);
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
      return errorResponse("The voice reader is busy right now. Try again in a moment.", 503);
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
