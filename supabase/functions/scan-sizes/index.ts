// Reads a handwritten MEASUREMENT SLIP with Gemini vision and returns one
// bill's worth of size lines. This is the third reader, and it exists because
// the other two both destroy this kind of paper:
//
//   scan-bill  expects a printed GST invoice with qty/rate/amount columns. A
//              timber slip has none of those — the quantity is never written,
//              it is DERIVED from the sizes — and no vendor or invoice number
//              to key the bill on.
//   scan-note  reads the paper as a single payment and throws away the sizes,
//              which is the entire content of the document.
//
// The shape this reads is how every Indian timber, marble and stone dealer
// hands over a bill: a material heading, then one line per size with a piece
// count, then a total quantity × a rate.
//
//     Teak
//     8¼ x 9 x 8 - I      (1)
//     8¼ x 9 x 7 - III    (3)
//     10 x 8 x 6 - I      (1)
//                 11 Pc
//              38.987 x 2451 = 95557
//              LBR    -          203
//                              95760
//
// The critical instruction below is that the model must NOT do the arithmetic:
// it transcribes the dimensions, and the app computes the volume and the money
// (see cftFrom + the reconciliation panel in BillReview). A vision model
// guessing at 8.25 × 9 × 6 ÷ 144 is exactly the step you cannot audit later.
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
    material: {
      type: "string",
      description:
        "The material heading written at the top — 'Teak', 'Sagwan', 'Sheesham', 'Marble', 'Granite'. Empty string if the slip has no heading.",
    },
    vendor: {
      type: "string",
      description:
        "The dealer / shop name if one is written or stamped. Most kaccha slips have none — return an empty string rather than guessing.",
    },
    date: {
      type: "string",
      description:
        "ISO date YYYY-MM-DD. Indian handwriting is DAY-first: '5/7/26' is 5 July 2026, never 7 May. Empty string if no date is written.",
    },
    lines: {
      type: "array",
      description:
        "One entry per size line, in the order written. Transcribe the numbers exactly as written — do NOT multiply, divide, or convert anything.",
      items: {
        type: "object",
        properties: {
          length: {
            type: "number",
            description:
              "The FIRST number of the size, in feet. Fractions are written as a superscript or a small mark: '8¼' is 8.25, '8½' is 8.5, '7½' is 7.5. Convert the fraction to a decimal, nothing else.",
          },
          width: { type: "number", description: "The SECOND number of the size, in inches." },
          thickness: { type: "number", description: "The THIRD number of the size, in inches." },
          pieces: {
            type: "number",
            description:
              "How many pieces of this exact size. It is written as tally marks ('I', 'II', 'III', 'IIII'), and usually repeated as a digit in a circle at the end of the line. COUNT THE TALLY MARKS and cross-check against the circled digit; they should agree. Use 1 when neither is written.",
          },
          raw: {
            type: "string",
            description:
              "The size line copied verbatim as it appears, e.g. '8¼ x 9 x 7 - III'. Shown next to the parsed numbers so a misread is obvious.",
          },
        },
        required: ["length", "width", "thickness", "pieces", "raw"],
      },
    },
    totalPieces: {
      type: "number",
      description:
        "The piece total written on the slip, e.g. '11 Pc'. 0 if not written. Do not compute it — only report what is written.",
    },
    totalQty: {
      type: "number",
      description:
        "The total quantity the dealer wrote, e.g. the '38.987' in '38.987 x 2451'. This is his own cubic-feet figure. 0 if not written. Do NOT calculate it yourself.",
    },
    qtyUnit: {
      type: "string",
      description:
        "The unit that total is in: 'cft' for timber/stone sold by cubic feet (the default for a length-in-feet × inches × inches slip), 'sqft' for marble/tile slabs. Empty if genuinely unclear.",
    },
    rate: {
      type: "number",
      description: "Rate per unit in rupees — the '2451' in '38.987 x 2451'. 0 if not written.",
    },
    lineAmount: {
      type: "number",
      description:
        "The result the dealer wrote for quantity × rate — the '95557'. 0 if not written. Report his figure even if it looks wrong; the app checks the arithmetic.",
    },
    otherCharges: {
      type: "number",
      description:
        "Any extra added below the goods line: labour ('LBR', 'majdoori'), cartage ('bhada', 'dhulai'), sawing/cutting ('chirai'), loading. The 203 in 'LBR - 203'. 0 if none.",
    },
    otherChargesLabel: {
      type: "string",
      description:
        "What that extra is called on the slip, expanded to a readable English word — 'LBR' becomes 'Labour', 'chirai' becomes 'Sawing'. Empty if there is no extra.",
    },
    grandTotal: {
      type: "number",
      description:
        "The final figure at the bottom — the 95760. 0 if not written. Report what is written; do not recompute.",
    },
    originalText: {
      type: "string",
      description:
        "Verbatim transcription of everything on the paper, original script kept, line breaks preserved. Shown so the person can check the reading against the photo.",
    },
    confidence: {
      type: "string",
      description:
        "'high' when every size and the rate are clearly legible; 'medium' when mostly readable; 'low' when any dimension or the rate is a genuine guess.",
    },
  },
  required: [
    "material", "vendor", "date", "lines", "totalPieces", "totalQty", "qtyUnit",
    "rate", "lineAmount", "otherCharges", "otherChargesLabel", "grandTotal",
    "originalText", "confidence",
  ],
};

const PROMPT = `You are reading a photo of a handwritten MEASUREMENT SLIP from an Indian timber, marble or stone dealer. This is the "kaccha" bill a dealer writes out by hand when material is sold by size rather than by count.

Its structure is almost always:
- a material heading at the top ("Teak", "Sagwan", "Sheesham", "Marble")
- one line per size, written LENGTH x WIDTH x THICKNESS followed by a piece count
- a total piece count ("11 Pc")
- a total quantity multiplied by a rate ("38.987 x 2451 = 95557")
- sometimes an extra charge ("LBR - 203") and a final total

Your job is TRANSCRIPTION, not calculation. This is the most important rule here: report the numbers exactly as they are written on the paper and let the app do every multiplication. Do not compute cubic feet. Do not verify the dealer's total. Do not "fix" a figure that looks wrong — report it as written, because the app compares your reading against its own arithmetic and shows the person any disagreement. A silently corrected number destroys that check.

Reading the sizes:
- The convention is LENGTH IN FEET x WIDTH IN INCHES x THICKNESS IN INCHES. A line reading "8 x 9 x 6" is eight FEET long, nine INCHES wide, six INCHES thick. Do not convert between units — just report 8, 9 and 6.
- Fractions appear on the length as a small raised mark: "8¼" or "8'1/4" is 8.25, "8½" is 8.5, "7½" is 7.5, "9¾" is 9.75. A stray apostrophe is the foot mark, not part of the number.
- Because the first number is feet and the other two are inches, the first is usually 6-20 and the other two usually 3-12. If your reading makes the width or thickness larger than about 24, re-read it — you have probably misread a digit.

Reading the piece count:
- It is written as TALLY MARKS after a dash: "- I" is 1, "- II" is 2, "- III" is 3, "- IIII" is 4. These look like the digit 1 repeated; count the strokes.
- The same count is usually repeated as a digit inside a circle at the end of the line. Use it to confirm your tally. If the tally and the circled digit disagree, trust the circled digit and say so in originalText.
- Do not confuse the tally with the thickness: in "8¼ x 9 x 7 - III" the thickness is 7 and the pieces are 3.

Reading the money block:
- "38.987 x 2451 = 95557" means quantity 38.987, rate 2451 per cft, amount 95557.
- Indian digit grouping is lakh-based: "1,50,000" is 150000, never 1500.
- "LBR" is labour, "chirai" is sawing, "bhada"/"dhulai" is cartage. These are extra charges, not goods — put them in otherCharges.
- Devanagari numerals ० १ २ ३ ४ ५ ६ ७ ८ ९ map to 0-9.

If a size line is genuinely illegible, still include it with your best reading and set confidence to "low" — the person reviews every row against the photo before anything is saved.`;

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
