"""
Builds House-Ledger-User-Guide.pdf — a step-by-step guide for opening and
using the app on desktop and Android. Run with:
    /opt/homebrew/bin/python3.11 scripts/build-user-guide.py
"""

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    HRFlowable,
    ListFlowable,
    ListItem,
    KeepTogether,
)

# Palette matching the app's ledger/accounting aesthetic
INK = colors.HexColor("#182B3A")
INK_SOFT = colors.HexColor("#3D5266")
PAPER = colors.HexColor("#F2F3EF")
RULE = colors.HexColor("#D8D9D2")
CRIMSON = colors.HexColor("#A63A2B")
MOSS = colors.HexColor("#2F6D4F")

APP_URL = "https://your-house-ledger.vercel.app"

OUT_PATH = "House-Ledger-User-Guide.pdf"

styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    "TitleBig", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=26, textColor=INK, spaceAfter=6, alignment=TA_LEFT,
    letterSpacing=1,
)
subtitle_style = ParagraphStyle(
    "Subtitle", parent=styles["Normal"], fontName="Helvetica",
    fontSize=13, textColor=INK_SOFT, spaceAfter=18,
)
h1_style = ParagraphStyle(
    "H1", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=17, textColor=INK, spaceBefore=22, spaceAfter=10,
    borderPadding=0,
)
h2_style = ParagraphStyle(
    "H2", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=12.5, textColor=CRIMSON, spaceBefore=14, spaceAfter=6,
)
body_style = ParagraphStyle(
    "Body", parent=styles["Normal"], fontName="Helvetica",
    fontSize=10.3, textColor=colors.HexColor("#1E1E1E"), leading=15,
    spaceAfter=6,
)
step_style = ParagraphStyle(
    "Step", parent=body_style, leftIndent=14, spaceAfter=7, leading=15,
)
note_style = ParagraphStyle(
    "Note", parent=body_style, fontName="Helvetica-Oblique",
    textColor=INK_SOFT, fontSize=9.6, leftIndent=10, spaceBefore=2,
)
warn_style = ParagraphStyle(
    "Warn", parent=body_style, fontName="Helvetica-Bold",
    textColor=CRIMSON, fontSize=9.8, spaceBefore=4, spaceAfter=8,
)
url_style = ParagraphStyle(
    "Url", parent=body_style, fontName="Courier-Bold", fontSize=11,
    textColor=INK, backColor=PAPER, spaceBefore=4, spaceAfter=8,
    leftIndent=8, borderPadding=6, borderColor=RULE, borderWidth=1,
)
toc_style = ParagraphStyle(
    "Toc", parent=body_style, fontSize=10.5, leading=18,
)


def rule():
    return HRFlowable(width="100%", thickness=1, color=RULE, spaceBefore=4, spaceAfter=10)


def numbered(items, style=step_style):
    return ListFlowable(
        [ListItem(Paragraph(t, style), value=i + 1) for i, t in enumerate(items)],
        bulletType="1",
        start=1,
        leftIndent=20,
        bulletFontName="Helvetica-Bold",
        bulletColor=CRIMSON,
        spaceBefore=2,
        spaceAfter=10,
    )


def bulleted(items, style=step_style):
    return ListFlowable(
        [ListItem(Paragraph(t, style)) for t in items],
        bulletType="bullet",
        leftIndent=20,
        bulletColor=INK_SOFT,
        spaceBefore=2,
        spaceAfter=10,
    )


story = []

# ---------- Cover ----------
story.append(Spacer(1, 1.3 * inch))
story.append(Paragraph("HOUSE LEDGER", title_style))
story.append(Paragraph("How to open and use the app — Desktop &amp; Android", subtitle_style))
story.append(rule())
story.append(Spacer(1, 0.15 * inch))
story.append(Paragraph(
    "House Ledger is an offline-first expense tracker for the house-building "
    "project. It runs entirely in your browser — there is nothing to install "
    "on a desktop, and on a phone it can be added to your home screen like a "
    "regular app. All of your data lives on your own device; "
    "nothing is sent anywhere.",
    body_style,
))
story.append(Spacer(1, 0.25 * inch))
story.append(Paragraph("Contents", h2_style))
toc_items = [
    "1.  Before you start",
    "2.  Opening the app on your desktop",
    "3.  Installing the app on your Android phone",
    "4.  Dashboard — your running total",
    "5.  + Entry — adding an expense",
    "6.  Ledger — searching and managing entries",
    "7.  BOQ — scanning and tracking itemized bills",
    "8.  Stock — inventory given to labour vs. left with you",
    "9.  Data — backup, restore &amp; reset",
    "10. Good habits &amp; troubleshooting",
]
for t in toc_items:
    story.append(Paragraph(t, toc_style))
story.append(PageBreak())

# ---------- 1. Before you start ----------
story.append(Paragraph("1. Before you start", h1_style))
story.append(Paragraph(
    "House Ledger lives at one web address (URL). This guide uses a "
    "placeholder — replace it with your app's real address once it's "
    "deployed:",
    body_style,
))
story.append(Paragraph(APP_URL, url_style))
story.append(Paragraph(
    "<b>Where to get the real URL:</b> whoever set up the app deploys it "
    "once (for example, to Vercel) and that step produces this address. "
    "Ask them for it, or check the project's README for the exact deploy "
    "steps if you're setting it up yourself. Once you have it, every "
    "step below is the same — just swap in your real address.",
    body_style,
))
story.append(Paragraph(
    "You do not need to install any software to use House Ledger on a "
    "desktop computer — it opens in your normal web browser (Chrome, Edge, "
    "or Safari). On Android, you'll install it as an app icon in a couple "
    "of taps, covered in Section 3.",
    body_style,
))

# ---------- 2. Desktop ----------
story.append(Paragraph("2. Opening the app on your desktop", h1_style))
story.append(Paragraph(
    "Works in Chrome, Edge, or Safari on Windows, Mac, or Linux.",
    body_style,
))
story.append(numbered([
    "Open your web browser.",
    f"Type the app's address into the address bar: <b>{APP_URL}</b> and press Enter.",
    "Wait a few seconds for the page to load fully the first time — this also "
    "quietly saves a copy of the app on your computer so it can open instantly "
    "(and even offline) the next time.",
    "You'll see the dark navy <b>HOUSE LEDGER</b> header and the Dashboard. "
    "You're in.",
]))
story.append(Paragraph("Optional: pin it as its own desktop app", h2_style))
story.append(Paragraph(
    "Chrome and Edge can install House Ledger as a standalone app window "
    "(no address bar, its own icon), the same way it works on a phone:",
    body_style,
))
story.append(numbered([
    "Look at the right side of the address bar for a small install icon "
    "(a monitor with a downward arrow, or a <b>+</b> in a box).",
    "Click it, then click <b>Install</b> in the popup.",
    "House Ledger now opens from your Desktop, Start Menu, or Dock like any "
    "other application.",
]))
story.append(Paragraph(
    "If you don't see the install icon, you can skip this — a regular "
    "browser tab works exactly the same way and keeps the same data.",
    note_style,
))

# ---------- 3. Android install ----------
story.append(Paragraph("3. Installing the app on your Android phone", h1_style))
story.append(Paragraph(
    "This must be done in the <b>Chrome</b> app (not Samsung Internet or "
    "another browser) for the install prompt to appear correctly.",
    body_style,
))
story.append(numbered([
    "Open the <b>Chrome</b> app on your phone.",
    f"Tap the address bar at the top and type: <b>{APP_URL}</b>, then tap Go.",
    "Wait for the page to fully load. Keep the screen open for a few seconds — "
    "this lets the app save itself for offline use.",
    "Tap the menu button — <b>three vertical dots</b> in the top-right corner.",
    "Tap <b>Add to Home screen</b> (on some phones this appears as an "
    "<b>Install app</b> banner near the address bar instead — tap that if "
    "you see it).",
    "Confirm by tapping <b>Add</b> or <b>Install</b> on the popup.",
    "Go to your phone's home screen. You'll see a new <b>House Ledger</b> "
    "icon (dark navy square with a stacked-coins symbol).",
    "Tap the icon to open it. The app fills the whole screen — no browser "
    "address bar or tabs — exactly like a normal installed app.",
]))
story.append(Paragraph(
    "From now on, always open the app from this home screen icon, not by "
    "typing the address into Chrome again — the icon is faster and works "
    "offline immediately.",
    warn_style,
))
story.append(Paragraph(
    "Everything in the app works with no internet connection at all — "
    "adding entries, viewing the dashboard, adding bills, and backing up or "
    "restoring your data. You can safely use it in airplane mode.",
    note_style,
))

# ---------- 4. Dashboard ----------
story.append(PageBreak())
story.append(Paragraph("4. Dashboard — your running total", h1_style))
story.append(Paragraph(
    "This is the screen you land on when you open the app. It updates "
    "instantly every time you add, edit, or delete anything.",
    body_style,
))
story.append(bulleted([
    "The large bold number at the top is the <b>total spent</b> across every "
    "entry in the ledger.",
    "Below it, a bar for each of the 11 categories (Sharik, Nitin, Wood, "
    "Electrical, Govt Fee/Chalan, MDA/Mutation, Gift, Site Prep, Legal, "
    "Utility Bill, Misc) shows how much has gone to each.",
    "At the bottom, a list shows how much each family member has personally "
    "paid so far.",
]))
story.append(Paragraph(
    "There's nothing to tap here to change data — this screen is read-only. "
    "Use the tabs at the bottom of the screen to add or edit entries.",
    note_style,
))

# ---------- 5. + Entry ----------
story.append(Paragraph("5. + Entry — adding an expense", h1_style))
story.append(Paragraph(
    "Tap the <b>+ Entry</b> tab at the bottom to log a new payment. Fill in "
    "the fields:",
    body_style,
))
story.append(numbered([
    "<b>Date</b> — defaults to today; tap it to pick a different date.",
    "<b>Category</b> — choose the closest fit from the dropdown (e.g. "
    "\"Sharik\" for a payment to that contractor).",
    "<b>Description</b> — a short label, e.g. \"Payment to Sharik\". "
    "Required.",
    "<b>Sub-vendor / detail</b> — optional; a shop or sub-contractor name, "
    "e.g. \"Kisan Treders\".",
    "<b>Amount (₹)</b> — the rupee amount. Required, and must be more than "
    "zero.",
    "<b>Payment mode</b> — Cash, one of the GPay accounts, Cheque, etc.",
    "<b>Paid by</b> — which family member made the payment.",
    "<b>Notes</b> — optional, anything else worth remembering.",
    "Tap the crimson <b>Save entry</b> button.",
]))
story.append(Paragraph(
    "If the description is empty or the amount is zero, the app shows an "
    "error message under the form and won't save until it's fixed — this "
    "prevents accidental blank or ₹0 entries from polluting the ledger.",
    warn_style,
))
story.append(Paragraph(
    "After saving, a small \"✓ Entry saved\" confirmation appears and the "
    "form clears, ready for the next entry.",
    note_style,
))

# ---------- 6. Ledger ----------
story.append(PageBreak())
story.append(Paragraph("6. Ledger — searching and managing entries", h1_style))
story.append(Paragraph(
    "Tap the <b>Ledger</b> tab to see every entry ever recorded, newest "
    "first.",
    body_style,
))
story.append(bulleted([
    "<b>Search box</b> — type any word from the description, vendor, notes, "
    "payer, or payment mode to filter the list instantly.",
    "<b>Category dropdown</b> (next to search) — narrow the list to one "
    "category at a time.",
    "Each row shows the description, date, a small category badge, payment "
    "mode, who paid, and the amount.",
    "The total shown just above the list reflects only the entries "
    "currently visible (i.e. after your search/filter) — handy for adding up "
    "a specific category or vendor.",
]))
story.append(Paragraph("Deleting an entry", h2_style))
story.append(numbered([
    "Tap the small <b>delete</b> link under an entry's amount.",
    "Two buttons appear: <b>Delete</b> (confirms) and <b>Keep</b> (cancels). "
    "This two-tap confirmation prevents accidental deletion.",
    "Tap <b>Delete</b> to remove it permanently, or <b>Keep</b> to back out.",
]))
story.append(Paragraph("Exporting to CSV", h2_style))
story.append(Paragraph(
    "Tap <b>Backup CSV</b> above the list to download a spreadsheet file of "
    "exactly what's currently visible (respecting your search/filter). "
    "Useful for opening in Excel or sharing a specific category's spend.",
    body_style,
))

# ---------- 7. BOQ ----------
story.append(Paragraph("7. BOQ — scanning and tracking itemized bills", h1_style))
story.append(Paragraph(
    "BOQ (\"Bill of Quantities\") is for recording the individual line items "
    "on a shop or contractor invoice — separate from the simple one-line "
    "ledger entries in Section 5.",
    body_style,
))
story.append(Paragraph("Scanning a bill with the camera", h2_style))
story.append(Paragraph(
    "The scanner reads the photo <b>on your phone itself</b> — free, no "
    "internet needed, and the photo never leaves the device.",
    body_style,
))
story.append(numbered([
    "Tap the <b>BOQ</b> tab, then tap <b>Scan bill</b> (or <b>Upload "
    "photo</b> for a picture already in your gallery).",
    "Photograph the bill: good light, bill flat, fill the frame, hold steady.",
    "Wait while it reads — a progress line shows e.g. \"Reading the bill on "
    "this phone… 60%\". The first scan takes the longest.",
    "A review screen opens with the vendor, invoice number, date, category "
    "(guessed from the products — paint words file it under Paint, pipes "
    "under Plumbing, and so on) and the line items it could read.",
    "<b>Check every row against the paper bill.</b> The reader makes "
    "mistakes, especially with numbers — tap any cell to correct it, use "
    "<b>+ add row</b> for lines it missed, and the × button to remove junk "
    "rows.",
    "Confirm the green \"lines sum ✓ match\" check against the printed "
    "total, then tap <b>Save bill</b>.",
]))
story.append(Paragraph(
    "Leave \"Add the material rows to Stock\" ticked (it is on by default) "
    "and every product with a quantity also lands in the Stock tab as "
    "received inventory — see Section 8.",
    note_style,
))
story.append(Paragraph("Typing a bill manually", h2_style))
story.append(numbered([
    "Tap the <b>BOQ</b> tab, then tap <b>Type manually</b>.",
    "Fill in <b>Vendor</b>, <b>Invoice #</b>, <b>Date</b>, and <b>Category</b>.",
    "Enter the <b>Invoice total</b> — the grand total printed on the physical "
    "bill.",
    "For each line on the bill, add a row: description, quantity, unit, "
    "rate, and amount. Tap <b>+ add row</b> for more lines (e.g. separate "
    "rows for SGST, CGST, or Rounding, exactly as printed).",
    "Check the summary line at the bottom: it shows whether your line items "
    "add up to the invoice total. If they match, it turns green with a "
    "checkmark. If not, it turns red and shows the difference.",
    "If there's a genuine mismatch you can't resolve, tick the "
    "acknowledgement checkbox that appears to save anyway.",
    "Only tick <b>\"Also create a ledger entry for this bill's total\"</b> if "
    "this payment <i>isn't</i> already recorded in the Ledger — otherwise "
    "you'll double-count it.",
    "Tap <b>Save bill</b>.",
]))
story.append(Paragraph("Reconciliation table", h2_style))
story.append(Paragraph(
    "Below the Add Bill button, a table compares, per category, how much "
    "you've itemized in BOQ bills versus how much is recorded in the Ledger "
    "— a quick sanity check on whether your itemized bills line up with your "
    "actual payments.",
    body_style,
))
story.append(Paragraph("Viewing and deleting bills", h2_style))
story.append(numbered([
    "Under <b>Bills on record</b>, tap any bill to expand it and see every "
    "line item.",
    "Tap <b>delete this bill</b>, then confirm, to remove the whole bill "
    "(all its line items) at once.",
]))

# ---------- 8. Stock ----------
story.append(PageBreak())
story.append(Paragraph(
    "8. Stock — inventory given to labour vs. left with you", h1_style,
))
story.append(Paragraph(
    "The <b>Stock</b> tab tracks every material — how much came in from "
    "bills, how much you handed to the labour, and how much is still with "
    "you. Items arrive here automatically when you save a scanned bill "
    "(Section 7), or you can add them by hand.",
    body_style,
))
story.append(Paragraph("Reading an item card", h2_style))
story.append(bulleted([
    "The big green number on the right is the <b>balance left with you</b> "
    "(it turns red if more went out than came in — a sign something wasn't "
    "recorded).",
    "Below the name: \"in 20 · out 8\" — total received vs. total given out.",
    "The <b>checkbox</b> on the left is for marking a material as finished / "
    "fully settled: tick it and the card greys out and drops to the bottom "
    "of the list, so the open items stay on top.",
    "Category chips at the top (Paint, Plumbing, Tiles, Marble, Wood, "
    "Aluminium, …) filter the list to one kind of material.",
]))
story.append(Paragraph("Recording a hand-over to labour", h2_style))
story.append(numbered([
    "Find the material's card (use the category chips to narrow down).",
    "Tap <b>− Given out</b>.",
    "Enter the quantity and, optionally, who took it (e.g. \"painter "
    "Ramesh\").",
    "Tap <b>Save</b> — the balance updates instantly, and the hand-over is "
    "recorded with today's date.",
]))
story.append(Paragraph(
    "Use <b>+ Received</b> the same way when material arrives without a "
    "scanned bill. Tap <b>History</b> on any card to see every dated "
    "movement; a wrong one can be deleted with its × button.",
    note_style,
))
story.append(Paragraph("Adding an item by hand", h2_style))
story.append(numbered([
    "Tap <b>+ Add item</b> at the top of the Stock tab.",
    "Enter the material name (e.g. \"Apex Ultima White 20L\"), pick its "
    "category, and give the unit you count it in (L, pcs, kg, bags…).",
    "Tap <b>Add to stock list</b>, then record quantities with "
    "<b>+ Received</b> / <b>− Given out</b>.",
]))
story.append(Paragraph(
    "The Dashboard also shows a compact \"Stock in hand\" list of open "
    "materials with their balances, so you see at a glance what's on site.",
    note_style,
))

# ---------- 9. Data ----------
story.append(PageBreak())
story.append(Paragraph("9. Data — backup, restore &amp; reset", h1_style))
story.append(Paragraph(
    "Tap the <b>Data</b> tab. This is your safety net — since everything "
    "lives only on this device, exporting a backup is the only way to "
    "protect against a lost or reset phone.",
    body_style,
))
story.append(Paragraph("Exporting a backup", h2_style))
story.append(numbered([
    "Tap <b>Export full backup (.json)</b>.",
    "A file downloads to your device containing every ledger entry and BOQ "
    "item.",
    "Move or copy that file somewhere safe — email it to yourself, save it "
    "to Google Drive, etc. Do this regularly.",
]))
story.append(Paragraph(
    "The \"Last backup\" date at the top of this screen turns red if it's "
    "been more than 7 days, or if you've never backed up — treat that as a "
    "reminder, not just decoration.",
    warn_style,
))
story.append(Paragraph("Restoring from a backup", h2_style))
story.append(numbered([
    "Tap <b>Import / restore from backup…</b> and choose a previously "
    "exported <b>.json</b> file.",
    "The app shows how many entries and BOQ items are in that file and warns "
    "that this will <b>replace</b> everything currently on the device.",
    "Confirm to proceed, or cancel to back out without changing anything.",
]))
story.append(Paragraph("Other options on this screen", h2_style))
story.append(bulleted([
    "<b>Entries CSV</b> / <b>BOQ CSV</b> — export either table separately as "
    "a spreadsheet.",
    "<b>Reset to seed data</b> — wipes everything and restores the original "
    "starting data. Requires confirming twice, since it can't be undone "
    "unless you've exported a backup first. Mainly useful while testing.",
]))

# ---------- 10. Tips ----------
story.append(Paragraph("10. Good habits &amp; troubleshooting", h1_style))
story.append(bulleted([
    "<b>Back up weekly at minimum.</b> The app keeps data only on the one "
    "device you're using — there's no cloud sync.",
    "<b>Always launch from the home-screen icon</b> on your phone, not by "
    "retyping the address in Chrome.",
    "<b>Airplane mode is fine.</b> Every screen — Dashboard, + Entry, "
    "Ledger, BOQ, and Data — works with no signal at all.",
    "<b>Android back button</b> takes you back to the Dashboard from any "
    "tab, and closes a bill's review screen, without ever closing the app "
    "itself.",
    "<b>If the app looks out of date after an update</b> was made to it, "
    "close it fully and reopen from the home screen icon — it fetches the "
    "newest version automatically the next time it's online.",
    "<b>If install doesn't appear</b> on Android, make sure you're using the "
    "Chrome app (not another browser), and that the page has fully finished "
    "loading before opening the three-dot menu.",
]))

doc = SimpleDocTemplate(
    OUT_PATH,
    pagesize=letter,
    topMargin=0.85 * inch,
    bottomMargin=0.85 * inch,
    leftMargin=0.9 * inch,
    rightMargin=0.9 * inch,
    title="House Ledger — User Guide",
    author="House Ledger",
)


def on_page(canvas, doc_):
    canvas.saveState()
    canvas.setFillColor(INK)
    canvas.rect(0, letter[1] - 0.28 * inch, letter[0], 0.28 * inch, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawString(0.9 * inch, letter[1] - 0.2 * inch, "HOUSE LEDGER — USER GUIDE")
    canvas.setFillColor(INK_SOFT)
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(letter[0] - 0.9 * inch, 0.55 * inch, f"Page {doc_.page}")
    canvas.restoreState()


doc.build(story, onFirstPage=on_page, onLaterPages=on_page)
print(f"Wrote {OUT_PATH}")
