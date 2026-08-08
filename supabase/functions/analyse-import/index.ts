// Works out how somebody ELSE's expense sheet is laid out, so it can be
// imported into the ledger.
//
// This is not the app's own .xlsx restore — that reads a workbook Brick Book
// wrote itself, with a known meta sheet and fixed columns. This one is for the
// file a person arrives with: a spreadsheet they have kept for years, or a
// note off their phone. There is no format to rely on. Columns are in any
// order, named anything, in any language; dates are day-first, month-first or
// Excel serials; amounts carry rupee signs and lakh grouping; a "Total" row
// sits at the bottom pretending to be a payment.
//
// IMPORTANT — what this function is deliberately NOT given: the file. It sees
// the sheet names, the first handful of rows, and nothing else. It returns a
// MAPPING (which column is the date, which is the amount, how dates are
// ordered) and the client then converts every row on the device. So a person's
// entire financial history never leaves their phone, one small call covers a
// file of any size, and the mapping can be shown and corrected before a single
// row is written.
//
// GEMINI_API_KEY is a Supabase Edge Function secret; never sent to the client.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL = "gemini-3.6-flash";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Column indices are used rather than header names: real sheets have blank
 * headers, duplicated headers and merged cells, and a position is unambiguous
 * where a name is not. -1 means "this field isn't in the sheet at all". */
const STRUCTURE_SCHEMA = {
  type: "object",
  properties: {
    sheetName: {
      type: "string",
      description:
        "Name of the sheet holding the individual payments. If several look plausible, pick the one with the most date+amount rows, NOT a summary or totals sheet.",
    },
    headerRowIndex: {
      type: "number",
      description:
        "0-based index, within the rows given to you, of the row containing column headings. Use -1 if the sheet has no header row and data starts immediately.",
    },
    firstDataRowIndex: {
      type: "number",
      description:
        "0-based index of the first row that is an actual payment. Skips titles, blank rows and merged banners above the table.",
    },
    dateCol: { type: "number", description: "0-based column index of the date. -1 if absent." },
    amountCol: { type: "number", description: "0-based column index of the amount paid. -1 if absent. If there are separate debit/credit columns, use the debit/expense one." },
    categoryCol: { type: "number", description: "0-based column index of the category/head of expense (e.g. Cement, Labour, Electrical). -1 if absent." },
    detailCol: { type: "number", description: "0-based column index of the vendor/person/shop paid. -1 if absent." },
    eventCol: { type: "number", description: "0-based column index of the description of what the payment was for. -1 if absent. May be the same as detailCol if one column carries both." },
    modeCol: { type: "number", description: "0-based column index of the payment method (Cash, UPI, Cheque, Bank). -1 if absent." },
    paidByCol: { type: "number", description: "0-based column index of WHO paid (which family member / account). -1 if absent." },
    notesCol: { type: "number", description: "0-based column index of free remarks. -1 if absent." },
    dateOrder: {
      type: "string",
      enum: ["dmy", "mdy", "ymd", "unknown"],
      description:
        "Order of the date parts as written. Indian sheets are almost always day-first (dmy): '5/7/26' means 5 July. Only say mdy if the data clearly proves it (e.g. a value like 12/25/2025). Use 'unknown' if you genuinely cannot tell.",
    },
    negativeMeansExpense: {
      type: "boolean",
      description:
        "True only if this sheet writes expenses as negative numbers and income as positive. Most simple expense sheets write everything positive — then this is false.",
    },
    skipRowPatterns: {
      type: "array",
      items: { type: "string" },
      description:
        "Text that marks a row as NOT a payment — 'Total', 'Subtotal', 'Balance', 'Grand Total', 'योग'. Matched case-insensitively against the row. Empty array if none seen.",
    },
    confidence: {
      type: "number",
      description: "0 to 1. How sure you are of this mapping overall.",
    },
    warnings: {
      type: "array",
      items: { type: "string" },
      description:
        "Short, plain-English things the person should check — 'The amount column also contains a running balance', 'Two date columns; used the first'. Empty array if none.",
    },
    questions: {
      type: "array",
      description:
        "Ask ONLY about things you could not resolve and that would change the imported numbers. Never ask about something you already decided confidently. Empty array is the normal, good case.",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Short stable id, e.g. 'date-order' or 'amount-col'." },
          question: { type: "string", description: "One plain-English sentence a non-technical person can answer. No jargon." },
          options: {
            type: "array",
            items: { type: "string" },
            description: "2-4 concrete answers to choose between, each phrased as what it would mean.",
          },
        },
        required: ["id", "question", "options"],
      },
    },
  },
  required: [
    "sheetName", "headerRowIndex", "firstDataRowIndex", "dateCol", "amountCol",
    "categoryCol", "detailCol", "eventCol", "modeCol", "paidByCol", "notesCol",
    "dateOrder", "negativeMeansExpense", "skipRowPatterns", "confidence",
    "warnings", "questions",
  ],
};

const CATEGORY_SCHEMA = {
  type: "object",
  properties: {
    mappings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          raw: { type: "string", description: "The category name exactly as it appears in their sheet." },
          suggested: {
            type: "string",
            description:
              "The best match from the existing category list, or empty string to keep their own name as a new category. Prefer keeping their name when nothing is a genuinely close match — a wrong merge is worse than an extra category.",
          },
          confidence: { type: "number", description: "0 to 1." },
          alternatives: {
            type: "array",
            items: { type: "string" },
            description: "Up to 3 other plausible existing categories, best first. Empty if none fit.",
          },
        },
        required: ["raw", "suggested", "confidence", "alternatives"],
      },
    },
  },
  required: ["mappings"],
};

const STRUCTURE_PROMPT = `You are reading the FIRST FEW ROWS of a spreadsheet or note that an Indian
homeowner or small contractor has used to track construction/household spending.
Your job is to work out its layout so the app can convert it into ledger rows.

You are given only a sample. Do not try to read every payment — identify the
STRUCTURE: which sheet, which row the headings are on, and which column holds
what.

Rules that matter:
- Dates are almost always DAY-first in India. '5/7/26' is 5 July 2026.
- Amounts may carry a rupee sign and Indian lakh grouping: '1,50,000' is 150000.
- A row reading 'Total', 'Grand Total', 'Balance' or similar is NOT a payment.
- Some sheets keep a running-balance column next to the amount. The amount is
  the money that moved on that row, not the balance.
- Headings may be in Hindi or Hinglish ('Tarikh' = date, 'Rakam'/'Raqam' =
  amount, 'Vivran' = description, 'Naam' = name).
- If one column mixes vendor and description, point both eventCol and detailCol
  at it; the app will handle it.

Only raise a question when you genuinely cannot decide and the answer changes
the imported figures. An empty questions array is the normal outcome.`;

const CATEGORY_PROMPT = `An Indian homeowner is importing their own expense sheet into a construction
ledger app. Below are the category names they used, and the categories that
already exist in the app.

For each of their names, decide whether it should merge into an existing
category or stay as its own new one. Keeping their own name is the safe default:
an extra category costs nothing, while a wrong merge silently files payments
under the wrong head and is hard to notice later.

Merge only on a clear match in meaning — 'Cement'/'Sariya'/'Steel' belong under
materials-type heads only if such a head exists; 'Mistri'/'Mazdoor'/'Labour' are
labour. Transliterated Hindi is common. If nothing fits well, return an empty
suggested string and list any near-misses as alternatives.`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function errorResponse(message: string, status: number): Response {
  return json({ error: message }, status);
}

// Same retry harness as scan-bill / scan-note — see those files for the
// reasoning. A rate limit here is cheap to survive and expensive not to: the
// alternative is the person mapping twelve columns by hand.
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

async function callGemini(
  apiKey: string,
  promptText: string,
  schema: unknown,
): Promise<{ ok: true; text: string } | { ok: false; response: Response }> {
  const geminiBody = JSON.stringify({
    model: MODEL,
    input: [{ type: "text", text: promptText }],
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema,
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
      lastDetail = `Could not reach Gemini: ${
        err instanceof Error ? err.message : String(err)
      }`;
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
      return {
        ok: false,
        response: errorResponse(
          "The AI reader's daily quota is used up. It resets tomorrow — you can still map the columns yourself in the meantime.",
          429,
        ),
      };
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
      return {
        ok: false,
        response: errorResponse(
          "The AI reader is busy right now. Try again in a moment, or map the columns yourself.",
          503,
        ),
      };
    }
    return {
      ok: false,
      response: errorResponse(
        lastStatus
          ? `Gemini error ${lastStatus}: ${lastDetail.slice(0, 500)}`
          : lastDetail,
        502,
      ),
    };
  }

  const data = await upstream.json();
  let text: string | undefined = data.output_text;
  if (!text && Array.isArray(data.steps)) {
    for (const step of data.steps) {
      const blocks = step?.content ?? step?.output ?? [];
      for (const b of Array.isArray(blocks) ? blocks : []) {
        if (typeof b?.text === "string") text = (text ?? "") + b.text;
      }
    }
  }
  if (!text) {
    return {
      ok: false,
      response: errorResponse("Gemini returned an empty response.", 502),
    };
  }
  return { ok: true, text };
}

/** Renders the sample as a compact grid the model can reason about positionally,
 * with explicit 0-based column indices so the indices it returns line up. */
function renderSheets(
  sheets: { name: string; rows: unknown[][] }[],
): string {
  return sheets
    .map((s) => {
      const body = s.rows
        .map(
          (row, i) =>
            `row ${i}: ` +
            row
              .map((cell, c) => `[${c}] ${cell === null || cell === undefined ? "" : String(cell)}`)
              .join(" | "),
        )
        .join("\n");
      return `--- sheet: "${s.name}" ---\n${body}`;
    })
    .join("\n\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") return errorResponse("POST only", 405);

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return errorResponse("Server is not configured with a Gemini API key.", 500);
  }

  let body: {
    mode?: "structure" | "categories";
    sheets?: { name: string; rows: unknown[][] }[];
    names?: string[];
    existing?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Expected a JSON body.", 400);
  }

  const mode = body.mode ?? "structure";

  if (mode === "categories") {
    const names = (body.names ?? []).filter((n) => typeof n === "string").slice(0, 200);
    const existing = (body.existing ?? []).filter((n) => typeof n === "string").slice(0, 100);
    if (names.length === 0) return json({ mappings: [] });

    const prompt = `${CATEGORY_PROMPT}

Their category names:
${names.map((n) => `- ${n}`).join("\n")}

Categories that already exist in the app:
${existing.map((n) => `- ${n}`).join("\n")}`;

    const result = await callGemini(apiKey, prompt, CATEGORY_SCHEMA);
    if (!result.ok) return result.response;
    try {
      return json(JSON.parse(result.text));
    } catch {
      return errorResponse("Gemini returned malformed JSON.", 502);
    }
  }

  const sheets = (body.sheets ?? []).filter(
    (s) => s && typeof s.name === "string" && Array.isArray(s.rows),
  );
  if (sheets.length === 0) {
    return errorResponse("Expected a sheets array with at least one sheet.", 400);
  }
  // Belt and braces against a client sending more than intended: the whole
  // point of this design is that only a sample ever leaves the device.
  const capped = sheets.slice(0, 8).map((s) => ({
    name: String(s.name).slice(0, 120),
    rows: s.rows.slice(0, 12).map((r) => (Array.isArray(r) ? r.slice(0, 30) : [])),
  }));

  const prompt = `${STRUCTURE_PROMPT}

${renderSheets(capped)}`;

  const result = await callGemini(apiKey, prompt, STRUCTURE_SCHEMA);
  if (!result.ok) return result.response;
  try {
    return json(JSON.parse(result.text));
  } catch {
    return errorResponse("Gemini returned malformed JSON.", 502);
  }
});
