import { useState } from "react";

/**
 * Where the app's explanations live now.
 *
 * Each screen used to carry its own paragraph of instructions, which is a
 * reasonable thing to write once and a bad thing to read every day: on a phone
 * that prose pushed the actual bills and payments below the fold, and after the
 * first week nobody is reading it anyway. The text is still worth having — it
 * answers real questions — so it moved here, folded shut, where someone can go
 * looking when they actually have the question.
 */
interface Qa {
  q: string;
  a: React.ReactNode;
}

const QUESTIONS: Qa[] = [
  {
    q: "How do I get a bill into the app?",
    a: (
      <>
        On the <b>BOQ</b> tab, <b>Take photo</b> opens the camera and{" "}
        <b>Photo / PDF</b> picks one you already have. A printed bill reads on
        the phone itself even with no signal. Handwriting and Hindi need a
        connection — they're read by an AI reader over the internet, and if it
        can't be reached the app says so rather than guessing.
      </>
    ),
  },
  {
    q: "What is the Size list button for?",
    a: (
      <>
        A timber or marble dealer prices by size rather than quantity — a slip
        written <span className="money">8¼ × 9 × 8 — 3 pc</span>. Size list
        reads those sizes, works out the cubic feet itself, and checks its total
        against the one the dealer wrote at the bottom. If the two disagree it
        tells you before you save, which is the whole point: it catches his
        arithmetic and a misread size alike.
      </>
    ),
  },
  {
    q: "A handwritten bill also shows what I paid. Where does that go?",
    a: (
      <>
        A vendor's notebook bill is two records at once — the goods, and the
        "जमा / शेष" line saying what you handed over and what's still owed.
        After scanning, pick <b>Bill only</b>, <b>Payment only</b>, or{" "}
        <b>Both</b>. Choosing Both files the material rows under BOQ and adds
        one ledger entry for the amount actually <i>paid</i> — not the bill
        total — dated the day the money moved, with the balance in its notes.
      </>
    ),
  },
  {
    q: "What's the difference between a person and a category?",
    a: (
      <>
        Nothing, mechanically — that's the point. On <b>People</b> you can add{" "}
        <b>Electrician</b> apart from Electrical items, or <b>Painter</b> apart
        from Paint, so labour and material don't pile into one number. Each new
        one becomes its own section everywhere: the Entry form, Ledger filters,
        BOQ, Stock and the Dashboard.
      </>
    ),
  },
  {
    q: "What does Paid vs billed mean on the Ledger?",
    a: (
      <>
        Money handed over that no bill accounts for yet. The app has always
        known both halves — payments on one tab, bills on another — but until
        they sit side by side, an advance for material nobody delivered looks
        exactly like one that was honoured. A gap is not proof of anything:
        labour and wages never have a bill. It's worth a question when the
        payment was for material.
      </>
    ),
  },
  {
    q: "How do I give a contractor access?",
    a: (
      <>
        Give him the site code on the <b>Data</b> tab and approve his request
        when it appears there. He sees only the money between you and him —
        never the rest of your ledger, and never your other vendors, budget or
        bank details. Both sides record their own figures and neither can edit
        the other's, so a disagreement shows up as a flagged mismatch instead of
        one side quietly restating the other.
      </>
    ),
  },
  {
    q: "Which backup should I keep?",
    a: (
      <>
        <b>JSON</b> is the complete one — it's the only format that carries the
        bill photos, which for an unbilled payment are often the sole record it
        happened. Keep it somewhere safe (Drive, email). <b>Excel</b> is for
        reading and fixing: it opens on any phone or laptop, you can correct a
        figure in the sheet and upload it back. It carries no photos, so
        restoring one leaves the photos already on your phone untouched.
      </>
    ),
  },
  {
    q: "Is my data safe if I lose this phone?",
    a: (
      <>
        Only if you've signed in or taken a backup. Signed in, the ledger syncs
        to the cloud and any other phone on the same household sees it. Signed
        out, everything lives on this device alone — so export a backup
        regularly. <b>Last backup</b> on the Data tab turns red once it's more
        than a week old.
      </>
    ),
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="space-y-2">
      <h2 className="eyebrow">Questions</h2>
      <div className="card overflow-hidden divide-y divide-rule">
        {QUESTIONS.map((item, i) => (
          <div key={item.q}>
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-[13px] font-medium active:bg-ink/5"
              aria-expanded={open === i}
              onClick={() => setOpen((cur) => (cur === i ? null : i))}
            >
              <span>{item.q}</span>
              <span
                className={`text-ink-soft shrink-0 transition-transform ${
                  open === i ? "rotate-90" : ""
                }`}
              >
                ›
              </span>
            </button>
            {open === i && (
              <div className="px-3 pb-3 -mt-0.5 text-[13px] text-ink-soft leading-relaxed">
                {item.a}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
