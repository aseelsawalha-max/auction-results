# Auction Results Dashboard

An operational dashboard that closes the loop between "a unit went to auction"
and "here's what actually happened to it." Built for Site Managers,
Operations Managers, the Auctions team, and leadership to answer, in a couple
of clicks: **which units from my facility went to auction, and what was the
final outcome?**

## What it does

- **Upload any LockerFox auction-results Excel export** (`.xlsx`/`.xls`).
  The filename doesn't matter — columns are detected by header text, not by
  file name or column position.
- **Merges into history automatically.** Re-uploading a later export updates
  existing auctions in place (e.g. `UNSOLD` → `SOLD`) instead of creating
  duplicates, and preserves every auction that isn't in the newest file.
- **Facility-first navigation.** Pick a facility + month/year and see every
  unit and its outcome in one table — the primary Site Manager workflow.
- **Overview KPIs** (Total / Sold / Picked Up / Unsold / Voided / Canceled /
  Other / Total Winning Bids) recalculate live as filters change.
- **System Status page** shows the last successful upload, records
  added/updated, total historical records, and any data-quality warnings —
  this is the page to check after every upload.
- **Forward-compatible with schema drift.** Unrecognized columns are kept and
  shown in the auction detail view instead of being dropped; unrecognized
  status values are preserved verbatim and flagged, not rejected.

## Running it

```bash
npm install
npm run dev       # local dev server
npm run build     # production build (outputs to dist/)
npm run preview   # serve the production build locally
npm test          # unit tests for the parsing/merge/dedup engine
```

`dist/` is a static site — the whole app runs in the browser. To make it
reachable by the whole team, deploy `dist/` to any static host (S3/CloudFront,
Netlify, Vercel, GitHub Pages, an internal web server, etc.).

`sample-data/` has two example exports (with deliberately different,
LockerFox-style filenames) you can drop in to try the flow: the second
changes unit A001 from `UNSOLD` to `SOLD`, adds new units, introduces an
unrecognized status (`RELISTED`), and includes a row with a blank facility —
useful for seeing the merge/update behavior and data-quality warnings without
waiting for a real export.

## How matching/deduplication works

Each row from an upload is matched to an existing auction using, in order of
preference:

1. **A native LockerFox auction ID**, if the export includes one (any column
   recognized as an ID/auction-number field).
2. Otherwise, a **composite key of Facility + Unit + Auction Close**.

When a match is found, only the fields the new file actually has non-blank
values for are updated — a blank cell in a later export never erases
previously known data. Every change is recorded in that auction's history
(visible in the detail view) along with which upload caused it.

Column detection (`src/lib/columnMapping.ts`) matches on normalized header
text (case/punctuation/whitespace-insensitive) against a list of aliases per
field, so exports don't need exact header names. Any column that isn't
recognized is preserved as-is under "Additional LockerFox Fields" in the
auction detail view — nothing is ever silently dropped.

## Data storage & important limitation

Auction history is stored in the browser's `localStorage`, scoped to
whichever browser/device processes the uploads. This means:

- Data persists across page reloads and browser restarts on that device.
- **It is not currently shared across different computers/browsers.** If
  multiple people (SM, Ops, Auctions team) need to see the same data from
  their own devices, the uploaded file needs to be processed on a device/
  browser they all point to (e.g. one shared machine, or the app deployed
  behind a URL where uploads happen from one place), or the app needs a real
  backend (a small API + database) so uploads on one device become visible to
  everyone else. That backend is a natural next step if shared multi-device
  access turns out to be required — the parsing/merge/validation logic in
  `src/lib` is UI-agnostic and would move over directly.

## Project structure

```
src/lib/            Parsing, column detection, merge/dedup engine, filters
                     (pure functions, unit-tested, no React dependency)
src/hooks/           Dataset + Filters React context/state
src/components/     UploadPanel, FiltersBar, ResultsTable, KPI cards, etc.
src/pages/           Overview, FacilityResults, SystemStatus
src/lib/__tests__/   Vitest coverage of the merge/dedup engine, incl. the
                     UNSOLD -> SOLD update scenario and native-ID dedup
```

## On the "upload reminder every 2 hours"

This app itself has no way to page you — it's a static site that only acts
when you open it and drop in a file. The 2-hour reminder needs to come from
outside the app (e.g. a recurring scheduled prompt on your Claude account
that just says "please upload the latest LockerFox export"). If the schedule
that kicked off this build is set to re-run this entire spec every 2 hours,
it's worth pointing it at a short reminder prompt instead — repeating a full
rebuild instruction every 2 hours isn't necessary once the dashboard exists.
