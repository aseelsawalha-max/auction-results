# Auction Results Dashboard

An operational dashboard that closes the loop between "a unit went to auction"
and "here's what actually happened to it." Built for Site Managers,
Operations Managers, the Auctions team, and leadership to answer, in a couple
of clicks: **which units from my facility went to auction, and what was the
final outcome?**

## Architecture

```
Admin (authenticated) ──upload──▶ Supabase Postgres ──realtime──▶ Read-only dashboard
                                   (RLS enforces writes            (public, no login,
                                    require an admin session)       select-only)
```

There is **one shared database** (Supabase Postgres) and no local/browser
storage of auction data. Read access is public (no login required — anyone
with the link can view); write access requires an authenticated admin
session, and that restriction is enforced by the database itself via **Row
Level Security** (`supabase/migrations/0001_init.sql`), not just by hiding the
upload button in the UI. A read-only user cannot write data even by calling
the Supabase REST API directly with the browser's network tools — the anon
key they'd use has no write grant under RLS.

- **`/`** and **`/facility`** — the public, read-only dashboard (Overview,
  Facility Results, auction detail). No upload control exists on these
  routes at all.
- **`/admin`** — sign-in required. Once signed in, only users listed in the
  database's `admin_users` table see the upload/system-status screen;
  anyone else sees "Not Authorized."

## What it does

- **Upload any LockerFox auction-results Excel export** — both the legacy
  binary `.xls` format (what LockerFox actually produces) and `.xlsx` are
  supported. The filename doesn't matter — columns are detected by header
  text, not by file name or column position.
- **Merges into history automatically.** Re-uploading a later export updates
  existing auctions in place (e.g. `UNSOLD` → `SOLD`) instead of creating
  duplicates, and preserves every auction that isn't in the newest file.
- **Facility-first navigation.** Pick a facility + month/year and see every
  unit and its outcome in one table — the primary Site Manager workflow.
- **Overview KPIs** (Total / Sold / Picked Up / Unsold / Voided / Canceled /
  Other / Total Winning Bids) recalculate live as filters change.
- **Admin dashboard** (`/admin`) shows the last successful upload, records
  added/updated, total historical records, and any data-quality warnings —
  this is the page to check after every upload.
- **Live updates.** The read-only dashboard subscribes to database changes
  and refreshes automatically the moment an admin uploads a new file — no
  page reload needed, and it's the same for every viewer on every device.
- **Forward-compatible with schema drift.** Unrecognized columns are kept and
  shown in the auction detail view instead of being dropped; unrecognized
  status values are preserved verbatim and flagged, not rejected.

## One-time setup: create the Supabase project

This app needs a Supabase project (free tier is enough) as its persistent
database, auth provider, and API — nothing else to stand up or host. Do this
once:

1. **Create a project** at [supabase.com](https://supabase.com) (any region).
2. **Run the schema migration.** Open the project's SQL Editor and run the
   full contents of [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
   This creates `auction_records`, `uploads`, `admin_users`, the `is_admin()`
   function, and the Row Level Security policies that separate read and
   write access.
3. **Create your admin account.** In the Supabase dashboard, go to
   Authentication → Users → Add user, and create yourself an email/password
   login (or invite yourself by email). Copy the new user's UUID.
4. **Grant that account admin rights** by running this in the SQL Editor
   (replace with the UUID from step 3):
   ```sql
   insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-000000000000');
   ```
   Repeat step 3–4 for any other person who should be able to upload.
5. **Get your API credentials.** Project Settings → API → copy the Project
   URL and the `anon` `public` key (**not** the `service_role` key — that one
   must never go in the frontend).
6. **Configure the app.** Copy `.env.example` to `.env.local` and fill in:
   ```
   VITE_SUPABASE_URL=https://<your-project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<your anon key>
   ```
   Set the same two variables in your hosting provider's environment
   variables when you deploy (see Deployment below).

Without these, the app shows a "Setup Required" screen instead of the
dashboard — there is intentionally no local-storage fallback.

## Running it

```bash
npm install
npm run dev       # local dev server
npm run build     # production build (outputs to dist/)
npm run preview   # serve the production build locally
npm test          # unit tests for the parsing/merge/dedup engine + DB mapping
```

`dist/` is a static site. Deploy it to any static host (Netlify, Vercel,
GitHub Pages, S3/CloudFront, an internal web server, etc.) with the two
`VITE_SUPABASE_*` environment variables set at build time. The database,
auth, and API all live in Supabase — the static host only needs to serve
files, so there's no server process to keep running or patch.

`sample-data/` has two example exports (with deliberately different,
LockerFox-style filenames) you can drop in to try the flow: the second
changes unit A001 from `UNSOLD` to `SOLD`, adds new units, introduces an
unrecognized status (`RELISTED`), and includes a row with a blank facility —
useful for seeing the merge/update behavior and data-quality warnings.

## How matching/deduplication works

Each row from an upload is matched to an existing auction using, in order of
preference:

1. **A native LockerFox auction ID**, if the export includes one (any column
   recognized as an ID/auction-number field).
2. Otherwise, a **composite key of Facility + Unit + Auction Close**.

When a match is found, only the fields the new file actually has non-blank
values for are updated — a blank cell in a later export never erases
previously known data. Every change is recorded in that auction's history
(visible in the detail view) along with which upload caused it. This logic
(`src/lib/merge.ts`) is unchanged from the original prototype and is
unit-tested in `src/lib/__tests__/merge.test.ts`.

On every upload, the admin client re-fetches the full dataset from Supabase
immediately before merging, so two admins uploading close together both
merge against the latest shared state rather than a stale local copy, and
the merged result is written back as a single batch of upserts keyed by
`dedupe_key` — the database enforces that key as a primary key, so the same
auction can never end up as two rows no matter how many times it's
re-uploaded.

Column detection (`src/lib/columnMapping.ts`) matches on normalized header
text (case/punctuation/whitespace-insensitive) against a list of aliases per
field, so exports don't need exact header names. Any column that isn't
recognized is preserved as-is (in a `jsonb` column) under "Additional
LockerFox Fields" in the auction detail view — nothing is ever silently
dropped.

## Security model

- **Read access:** public. The dashboard at `/` and `/facility` needs no
  login — RLS grants `select` on `auction_records` and `uploads` to
  everyone, which is what lets the whole team (SMs, Ops, Auctions,
  leadership) view results without individual accounts.
- **Write access:** only rows in `admin_users`. RLS grants `insert`/`update`
  on `auction_records` and `insert` on `uploads` only when
  `public.is_admin()` (a `SECURITY DEFINER` function checking the caller's
  `auth.uid()` against `admin_users`) returns true. This is checked by
  Postgres itself on every write — it holds even if a read-only user
  inspects network requests and tries to replay/modify one directly against
  the Supabase REST API.
- **`admin_users` itself** has RLS enabled with **no policies at all**, so it
  is not readable or writable from the client under any circumstances (anon
  or authenticated) — only from the Supabase SQL Editor/dashboard using your
  own account, which uses a privileged connection that bypasses RLS.
- **The Admin route (`/admin`)** is gated in the UI by Supabase Auth session
  state, but that's a convenience, not the security boundary — the boundary
  is the RLS policy above, so a stale or forged frontend session can't be
  used to write data either.
- The anon key shipped in the frontend bundle is meant to be public — that's
  how Supabase's model works. Never put the `service_role` key in this app
  or any frontend code.

## Project structure

```
supabase/migrations/  SQL schema, RLS policies, admin-check function — the
                       single source of truth for who can read/write what
src/lib/               Parsing, column detection, merge/dedup engine, filters,
                        and the Supabase row <-> domain-object mapping
                        (pure functions, unit-tested, no React dependency)
src/hooks/             Auth (Supabase session + admin check), Dataset (fetch
                        + realtime subscription + merge/persist), Filters
src/components/        UploadPanel, FiltersBar, ResultsTable, KPI cards, etc.
src/pages/              Overview, FacilityResults (public); AdminLogin,
                        AdminDashboard (gated by /admin)
src/lib/__tests__/     Vitest coverage of the merge/dedup engine (incl. the
                        UNSOLD -> SOLD update scenario and native-ID dedup)
                        and the Supabase row-mapping functions
```

## On the "upload reminder every 2 hours"

This app has no way to page you on its own — an admin has to open `/admin`
and drop in the file. The 2-hour reminder needs to come from outside the app
(e.g. a recurring scheduled prompt on your Claude account that just says
"please upload the latest LockerFox export").
