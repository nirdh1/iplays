# Load a game schedule from a file

Team page → משחקים → **טעינת לוח משחקים מקובץ**. Staff and any member of the team (a parent too) can use it.

Accepted files: a screenshot or photo (e.g. of the team's games page on the IFA site), PDF, Excel (.xlsx) or CSV.
The app shows every game it found for the team; the user fixes date, time, opponent, home/away and venue,
unticks what they don't want, and saves. Games the team already has that day (same opponent, or any IFA game) are
skipped. A game without a time is saved as "שעה טרם נקבעה" until someone sets it.

## How files are read (free, in the browser, no AI)

- Excel / CSV: built-in reader (first sheet; date and time cells by their format).
- PDF: pdf.js text extraction. A scanned PDF has no text: take a screenshot instead.
- Image: tesseract.js OCR (Hebrew + English). The engine and language data (a few MB) load from the jsDelivr CDN
  the first time, then the browser caches them. Small screenshots are enlarged before OCR. OCR makes mistakes
  (letters, digits), so the review screen matters.

Rows are rebuilt from text positions. With a header row (תאריך + יריבה, or תאריך + קבוצה ביתית/אורחת) columns
are used; otherwise each row is read by its date (or the last date above it), time, the team's name and the
name next to it (the first team in the row, right to left, is the home team).

## Setup (once)

Run `supabase/migrations/20261103100000_schedule_import.sql` in the Supabase SQL Editor.
Rollback: `supabase/rollback/20261103100000_schedule_import.down.sql` (imported games stay). Nothing else.
