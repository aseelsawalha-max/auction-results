-- =============================================================================
-- ONE-TIME CLEANUP PROPOSAL — NOT YET EXECUTED. Review every step before use.
--
-- Merges the duplicate auction_records created by the timezone-dependent
-- dedupe key (see src/lib/merge.ts / normalize.ts for the root cause): the
-- same LockerFox auction was stored twice with auction_close_raw values that
-- differ by the uploader's UTC offset (e.g. 07:02Z vs 14:02Z), and therefore
-- different dedupe_key values.
--
-- Safety design:
--   * The script runs inside a transaction that ends in ROLLBACK. Nothing is
--     changed until you have inspected the dry-run output and deliberately
--     replace the final ROLLBACK with COMMIT.
--   * A full snapshot of auction_records is taken first (outside the
--     transaction, so it survives a rollback) for point-in-time recovery.
--   * Pairs are detected by proximity of the close *instant* (< 24h apart for
--     the same facility+unit), not by equal auction_close date, so pairs whose
--     timezone shift crossed midnight (e.g. 22:02Z on the 22nd vs 07:02Z on
--     the 23rd) are caught too — a date-only GROUP BY misses those.
--   * The survivor of each pair is chosen exactly as the application now
--     chooses which copy to keep updating (merge.ts preferRecord). First
--     preference is the copy with the LATER close instant: each pair came from
--     one upload in the export's own timezone (correct instant) and one in
--     UTC (instant too early by the export zone's offset). Spot-checked
--     against LockerFox's Auction Report for Unit 238 at 2553 Atlantic:
--     "Wed 9/23/26 10:02 AM EDT" = 2026-09-23T14:02:00.000Z is correct, and
--     the 07:02Z twin is the shifted duplicate. Then most recent last_seen_at,
--     then last_updated_at, then current key format, then key. The survivor's
--     scalar fields (status, bid, ...) are kept as-is; only audit metadata is
--     merged in from the dropped twin.
--   * Guards abort the run if any group has more than two members (the
--     reported data had duplicate_count = 2 for all 99 groups).
--
-- Recommended order of operations:
--   1. Deploy the application fix.
--   2. Re-upload the latest LockerFox export once. The fixed merge matches
--      each existing record by identity and corrects its auction_close_raw to
--      the deterministic value (this shows as "updated" once, then stabilises).
--   3. Run this script (dry run first, then with COMMIT).
--   4. Optionally run Step 6 to move surviving old-format keys onto the
--      current format. The app does not require this (it matches old keys by
--      identity), but it simplifies the data going forward.
--
-- Run from the Supabase SQL editor as the postgres/service role (bypasses RLS).
-- =============================================================================

-- Step 0: snapshot (idempotent; outside the transaction on purpose).
create table if not exists public.auction_records_backup_20261001 as
  select * from public.auction_records;

begin;

-- Step 1: candidate pairs (dry run). Normalisation mirrors normalizeKeyPart():
-- trim, lower-case, collapse internal whitespace.
create temp table recs on commit drop as
select
  dedupe_key, facility, unit, status, auction_close_raw, auction_close,
  first_seen_at, last_updated_at, last_seen_at, source_files, history, extra,
  regexp_replace(lower(btrim(facility)), '\s+', ' ', 'g') as f_norm,
  regexp_replace(lower(btrim(unit)),     '\s+', ' ', 'g') as u_norm,
  case
    when auction_close_raw ~ '^\d{4}-\d{2}-\d{2}T' then auction_close_raw::timestamptz
    else auction_close::timestamptz
  end as close_ts,
  (dedupe_key ~ '\|\d{4}-\d{2}-\d{2}$') as is_current_format
from public.auction_records
where dedupe_key_is_native_id = false;

create temp table pairs on commit drop as
select
  a.dedupe_key as keep_key, b.dedupe_key as drop_key,
  a.facility, a.unit,
  a.auction_close_raw as keep_raw, b.auction_close_raw as drop_raw,
  a.status as keep_status, b.status as drop_status,
  a.last_seen_at as keep_last_seen, b.last_seen_at as drop_last_seen
from recs a
join recs b
  on  a.f_norm = b.f_norm
  and a.u_norm = b.u_norm
  and a.dedupe_key <> b.dedupe_key
  and a.close_ts is not null and b.close_ts is not null
  and abs(extract(epoch from (a.close_ts - b.close_ts))) < 86400
  -- Survivor ordering (a is the survivor): later close instant (the
  -- LockerFox-confirmed one), then later last_seen_at, then later
  -- last_updated_at, then current key format, then the lexically smaller key.
  -- The keys are swapped in the last position so "a.key < b.key" wins.
  and (a.close_ts, a.last_seen_at, a.last_updated_at, a.is_current_format, b.dedupe_key)
    > (b.close_ts, b.last_seen_at, b.last_updated_at, b.is_current_format, a.dedupe_key);

-- Inspect this. Expect ~99 rows; every row should visibly be the same auction.
select * from pairs order by facility, unit;
select count(*) as pair_count from pairs;

-- Step 2: guards — abort (do not COMMIT) if either query returns rows: it
-- means a group has 3+ members and the pairwise logic would overlap.
select keep_key, count(*) from pairs group by keep_key having count(*) > 1;
select drop_key, count(*) from pairs group by drop_key having count(*) > 1;
select keep_key from pairs where keep_key in (select drop_key from pairs);

-- Step 3: merge audit metadata from each dropped twin into its survivor.
update public.auction_records k
set
  source_files    = (select array_agg(distinct s) from unnest(k.source_files || d.source_files) as s),
  history         = (select coalesce(jsonb_agg(h order by (h->>'timestamp')), '[]'::jsonb)
                     from jsonb_array_elements(k.history || d.history) as h),
  extra           = d.extra || k.extra,          -- survivor's values win on conflict
  first_seen_at   = least(k.first_seen_at, d.first_seen_at),
  last_updated_at = greatest(k.last_updated_at, d.last_updated_at),
  last_seen_at    = greatest(k.last_seen_at, d.last_seen_at)
from pairs p
join public.auction_records d on d.dedupe_key = p.drop_key
where k.dedupe_key = p.keep_key;

-- Step 4: remove the dropped twins.
delete from public.auction_records
where dedupe_key in (select drop_key from pairs);

-- Step 5: verification before committing.
--   (a) No remaining near-duplicate pairs.
select count(*) as remaining_pairs
from public.auction_records a
join public.auction_records b
  on  regexp_replace(lower(btrim(a.facility)), '\s+', ' ', 'g') = regexp_replace(lower(btrim(b.facility)), '\s+', ' ', 'g')
  and regexp_replace(lower(btrim(a.unit)),     '\s+', ' ', 'g') = regexp_replace(lower(btrim(b.unit)),     '\s+', ' ', 'g')
  and a.dedupe_key < b.dedupe_key
  and abs(extract(epoch from (
        (case when a.auction_close_raw ~ '^\d{4}-\d{2}-\d{2}T' then a.auction_close_raw::timestamptz else a.auction_close::timestamptz end)
      - (case when b.auction_close_raw ~ '^\d{4}-\d{2}-\d{2}T' then b.auction_close_raw::timestamptz else b.auction_close::timestamptz end)
      ))) < 86400
where not a.dedupe_key_is_native_id and not b.dedupe_key_is_native_id;
--   (b) The reported figure: September PICKED-UP should now be 104, not 203.
select count(*) as september_picked_up
from public.auction_records
where upper(status) = 'PICKED-UP'
  and auction_close >= date '2026-09-01' and auction_close < date '2026-10-01';
--   (c) Row counts: before (snapshot) minus pair_count = after.
select (select count(*) from public.auction_records_backup_20261001) as before_count,
       (select count(*) from public.auction_records)                 as after_count;

-- Replace with COMMIT only after the dry-run output and verification look right.
rollback;

-- =============================================================================
-- Step 6 (OPTIONAL, separate run, after Step 1 of the recommended order has
-- corrected auction_close_raw): move surviving old-format composite keys onto
-- the current day-granularity format. Not required for correctness — the app
-- matches old keys by identity — but keeps the data uniform.
-- =============================================================================
-- begin;
-- -- Collision pre-check: must return 0 rows, otherwise duplicates remain.
-- with target as (
--   select dedupe_key,
--          'composite:' || regexp_replace(lower(btrim(facility)), '\s+', ' ', 'g')
--            || '|' || regexp_replace(lower(btrim(unit)), '\s+', ' ', 'g')
--            || '|' || left(auction_close_raw, 10) as new_key
--   from public.auction_records
--   where not dedupe_key_is_native_id
--     and auction_close_raw ~ '^\d{4}-\d{2}-\d{2}'
--     and dedupe_key !~ '\|\d{4}-\d{2}-\d{2}$'
-- )
-- select new_key, count(*) from target group by new_key having count(*) > 1
-- union all
-- select t.new_key, 1 from target t join public.auction_records r on r.dedupe_key = t.new_key;
--
-- update public.auction_records
-- set dedupe_key = 'composite:' || regexp_replace(lower(btrim(facility)), '\s+', ' ', 'g')
--                  || '|' || regexp_replace(lower(btrim(unit)), '\s+', ' ', 'g')
--                  || '|' || left(auction_close_raw, 10)
-- where not dedupe_key_is_native_id
--   and auction_close_raw ~ '^\d{4}-\d{2}-\d{2}'
--   and dedupe_key !~ '\|\d{4}-\d{2}-\d{2}$';
-- rollback; -- -> COMMIT once the pre-check returned 0 rows.
