import type { AuctionRecord, Dataset, UploadResult, UploadWarning, CanonicalField } from './types';
import type { ParsedRow } from './parseExcel';
import { parseDateFlexible, parseNumberFlexible, normalizeKeyPart, auctionCloseDayKey } from './normalize';

const KNOWN_STATUSES = new Set(['SOLD', 'PICKED-UP', 'PICKED UP', 'UNSOLD', 'VOID', 'VOIDED', 'CANCELED', 'CANCELLED']);

/**
 * Two records for the same facility+unit whose close instants are closer
 * together than this are treated as the same auction represented two ways.
 * The assumption behind it: a storage lien auction runs for days, so a unit
 * cannot genuinely close twice within 24 hours — a relisted unit closes days
 * later. Representation shifts, on the other hand, are at most a timezone
 * offset apart (≤14h; across midnight for evening closes): the old
 * browser-timezone-dependent key, or a later correction of the export clock
 * (exportClock.ts). This window is only consulted when the exact identity
 * lookup misses, and never on the strength of facility+unit alone — see the
 * conditions where it is applied.
 */
const NEAR_DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A composite key in the current (day-granularity) format. */
const CANONICAL_COMPOSITE_KEY_RE = /^composite:.*\|\d{4}-\d{2}-\d{2}$/;

/**
 * The stable identity of a LockerFox auction, independent of how any one
 * upload happened to represent its close time.
 *
 * Real LockerFox exports carry no auction ID (verified against an actual
 * export: Auction Close, Facility, Unit, Status, Attendees, Views, Bid, Void
 * Reason Code, Cancel Reason Code), so identity is normally the composite of
 * facility, unit and the close *calendar day* (the UTC day of the stored
 * close instant). Day granularity is deliberate: earlier versions keyed on
 * the full close timestamp text, and because that text was derived in the
 * uploader's local timezone (see excelCellDateToISO), the same auction
 * uploaded from two browsers in different timezones produced two keys and two
 * records. A unit cannot close twice in one day, but a relisted unit closes
 * on a later day and is correctly a separate auction.
 *
 * A native auction ID is still preferred whenever an export does include one.
 */
function auctionIdentity(
  auctionId: string | undefined,
  facility: string | undefined,
  unit: string | undefined,
  auctionCloseRaw: string | undefined,
): { identity: string; isNativeId: boolean } {
  if (auctionId && auctionId.trim()) {
    return { identity: `id:${normalizeKeyPart(auctionId)}`, isNativeId: true };
  }
  // An unparseable close value keeps the old behaviour (keyed by its text) so
  // such records are neither merged with each other nor orphaned.
  const day = auctionCloseDayKey(auctionCloseRaw) ?? normalizeKeyPart(auctionCloseRaw);
  return { identity: `composite:${normalizeKeyPart(facility)}|${normalizeKeyPart(unit)}|${day}`, isNativeId: false };
}

function facilityUnitKey(facility: string | undefined, unit: string | undefined): string {
  return `${normalizeKeyPart(facility)}|${normalizeKeyPart(unit)}`;
}

function closeInstant(record: Pick<AuctionRecord, 'auctionCloseRaw' | 'auctionClose'>): number | undefined {
  const iso = record.auctionCloseRaw ? parseDateFlexible(record.auctionCloseRaw) : record.auctionClose;
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return isNaN(t) ? undefined : t;
}

/**
 * When the database already holds more than one record for the same identity
 * (the duplicates created by the old key), choose which one new uploads keep
 * updating.
 *
 * First preference is the copy whose stored close instant is *later*: the
 * duplicate pairs were produced by one upload environment in the export's own
 * timezone (correct instant) and one in UTC (instant too early by the
 * export zone's offset — e.g. 07:02Z instead of the 14:02Z that LockerFox's
 * Auction Report confirms for "10:02 AM EDT"). Then the copy LockerFox has
 * most recently confirmed, then the most recently changed, then the one
 * already on the current key format, then a fixed tie-break so the choice is
 * deterministic across uploads.
 */
function preferRecord(a: AuctionRecord, b: AuctionRecord): boolean {
  const aInstant = closeInstant(a);
  const bInstant = closeInstant(b);
  if (aInstant !== undefined && bInstant !== undefined && aInstant !== bInstant) return aInstant > bInstant;
  if (a.lastSeenAt !== b.lastSeenAt) return a.lastSeenAt > b.lastSeenAt;
  if (a.lastUpdatedAt !== b.lastUpdatedAt) return a.lastUpdatedAt > b.lastUpdatedAt;
  const aCanonical = CANONICAL_COMPOSITE_KEY_RE.test(a.dedupeKey);
  const bCanonical = CANONICAL_COMPOSITE_KEY_RE.test(b.dedupeKey);
  if (aCanonical !== bCanonical) return aCanonical;
  return a.dedupeKey < b.dedupeKey;
}

function fieldValue(row: ParsedRow, mapping: Partial<Record<CanonicalField, string>>, field: CanonicalField): string {
  const header = mapping[field];
  if (!header) return '';
  return (row.values[header] ?? '').trim();
}

export function mergeUpload(
  dataset: Dataset,
  fileName: string,
  rows: ParsedRow[],
  mapping: Partial<Record<CanonicalField, string>>,
  unmappedColumns: string[],
  now: string,
): { dataset: Dataset; result: UploadResult } {
  const warnings: UploadWarning[] = [];
  const requiredFields: CanonicalField[] = ['facility', 'unit', 'status'];
  const missingRequired = requiredFields.filter((f) => !mapping[f]);
  if (missingRequired.length > 0) {
    warnings.push({
      severity: 'error',
      message: `Missing required column(s): ${missingRequired.join(', ')}. These rows cannot be reliably matched or displayed.`,
    });
  }

  // Every stored record, by its database key. Matched records keep their
  // existing key (even an old-format one) so the upsert updates that row
  // rather than inserting a second one.
  const recordsByKey = new Map(dataset.records.map((r) => [r.dedupeKey, r] as const));

  // Lookup indexes computed from each record's *fields*, not its stored key,
  // so records keyed under the old full-timestamp format are still found.
  const byIdentity = new Map<string, AuctionRecord>();
  const preexistingDuplicateIdentities = new Set<string>();
  // Candidates for the close-time proximity fallback: composite-keyed records
  // with a facility, a unit and a parseable close instant.
  const byFacilityUnit = new Map<string, AuctionRecord[]>();
  for (const r of dataset.records) {
    const { identity } = auctionIdentity(r.auctionId, r.facility, r.unit, r.auctionCloseRaw);
    const prev = byIdentity.get(identity);
    if (!prev) {
      byIdentity.set(identity, r);
    } else {
      preexistingDuplicateIdentities.add(identity);
      if (preferRecord(r, prev)) byIdentity.set(identity, r);
    }
    if (!r.dedupeKeyIsNativeId && r.facility && r.unit && closeInstant(r) !== undefined) {
      const fu = facilityUnitKey(r.facility, r.unit);
      byFacilityUnit.set(fu, [...(byFacilityUnit.get(fu) ?? []), r]);
    }
  }

  let recordsAdded = 0;
  let recordsUpdated = 0;
  let recordsUnchanged = 0;
  let rowsSkipped = 0;
  let nearDuplicateMatches = 0;
  const seenStatuses = new Set<string>();
  const blankFacilityRows: number[] = [];
  const blankUnitRows: number[] = [];
  const invalidDateRows: number[] = [];
  const unexpectedStatuses = new Set<string>();
  const rowKeysInThisFile = new Map<string, number[]>();

  for (const row of rows) {
    const facility = fieldValue(row, mapping, 'facility');
    const unit = fieldValue(row, mapping, 'unit');
    const auctionId = fieldValue(row, mapping, 'auctionId');
    const auctionCloseRaw = fieldValue(row, mapping, 'auctionClose');
    const status = fieldValue(row, mapping, 'status');

    if (!facility) blankFacilityRows.push(row.rowNumber);
    if (!unit) blankUnitRows.push(row.rowNumber);

    if (!facility && !unit) {
      // Nothing usable to key or display this row by; skip but flag it.
      rowsSkipped++;
      continue;
    }

    const { identity, isNativeId } = auctionIdentity(auctionId, facility, unit, auctionCloseRaw);

    const existingRowsForKey = rowKeysInThisFile.get(identity) ?? [];
    existingRowsForKey.push(row.rowNumber);
    rowKeysInThisFile.set(identity, existingRowsForKey);

    const auctionClose = auctionCloseRaw ? parseDateFlexible(auctionCloseRaw) : undefined;
    if (auctionCloseRaw && !auctionClose) invalidDateRows.push(row.rowNumber);

    if (status) {
      seenStatuses.add(status);
      if (!KNOWN_STATUSES.has(status.toUpperCase())) unexpectedStatuses.add(status);
    }

    const attendees = parseNumberFlexible(fieldValue(row, mapping, 'attendees'));
    const views = parseNumberFlexible(fieldValue(row, mapping, 'views'));
    const bid = parseNumberFlexible(fieldValue(row, mapping, 'bid'));
    const winner = fieldValue(row, mapping, 'winner');
    const voidReasonCode = fieldValue(row, mapping, 'voidReasonCode');
    const cancelReasonCode = fieldValue(row, mapping, 'cancelReasonCode');

    const extra: Record<string, string> = {};
    for (const col of unmappedColumns) {
      const val = (row.values[col] ?? '').trim();
      if (val) extra[col] = val;
    }

    const candidateFields: Partial<AuctionRecord> = {
      auctionId: auctionId || undefined,
      auctionClose,
      auctionCloseRaw: auctionCloseRaw || undefined,
      facility: facility || undefined,
      unit: unit || undefined,
      status: status || undefined,
      attendees,
      views,
      bid,
      winner: winner || undefined,
      voidReasonCode: voidReasonCode || undefined,
      cancelReasonCode: cancelReasonCode || undefined,
    };

    let existing = byIdentity.get(identity);

    // Close-time proximity fallback. A stored record whose close instant was
    // shifted across midnight — by the old browser-timezone-dependent key, or
    // by a later correction of the export clock — has a different identity
    // day. Find it by proximity, but only when ALL of these hold: the exact
    // identity lookup missed; the row has no native auction ID; the row has
    // both a facility and a unit; the row's close time parsed; and the
    // candidate (same facility and unit, with its own parseable close time)
    // closes within NEAR_DUPLICATE_WINDOW_MS. Facility and unit alone never
    // match anything.
    if (!existing && !isNativeId && facility && unit && auctionClose) {
      const instant = Date.parse(auctionClose);
      let best: AuctionRecord | undefined;
      let bestDistance = NEAR_DUPLICATE_WINDOW_MS;
      for (const candidate of byFacilityUnit.get(facilityUnitKey(facility, unit)) ?? []) {
        const candidateInstant = closeInstant(candidate);
        if (candidateInstant === undefined) continue;
        const distance = Math.abs(candidateInstant - instant);
        if (distance < bestDistance || (distance === bestDistance && best && preferRecord(candidate, best))) {
          best = candidate;
          bestDistance = distance;
        }
      }
      if (best) {
        existing = best;
        nearDuplicateMatches++;
        byIdentity.set(identity, best);
      }
    }

    // Defensive: never let a brand-new record's key collide with a row that
    // already exists under that exact key.
    if (!existing) existing = recordsByKey.get(identity);

    if (!existing) {
      const record: AuctionRecord = {
        dedupeKey: identity,
        dedupeKeyIsNativeId: isNativeId,
        ...candidateFields,
        extra,
        firstSeenAt: now,
        lastUpdatedAt: now,
        lastSeenAt: now,
        sourceFiles: [fileName],
        history: [
          {
            timestamp: now,
            sourceFile: fileName,
            changedFields: Object.entries(candidateFields)
              .filter(([, v]) => v !== undefined && v !== '')
              .map(([field, v]) => ({ field, from: undefined, to: String(v) })),
          },
        ],
      };
      recordsByKey.set(identity, record);
      byIdentity.set(identity, record);
      recordsAdded++;
    } else {
      const changedFields: { field: string; from: string | undefined; to: string | undefined }[] = [];
      // Note: 'auctionClose' (the parsed/derived date) is deliberately excluded here —
      // see the comment below where it's refreshed separately.
      const comparableFields = [
        'auctionId', 'auctionCloseRaw', 'facility', 'unit', 'status',
        'attendees', 'views', 'bid', 'winner', 'voidReasonCode', 'cancelReasonCode',
      ] as const;

      for (const field of comparableFields) {
        const newVal = candidateFields[field];
        const oldVal = existing[field];
        // Only treat as a change when the new file actually supplies a non-empty value
        // that differs — a blank cell in a later export should not erase known data.
        if (newVal !== undefined && newVal !== '' && String(newVal) !== String(oldVal ?? '')) {
          changedFields.push({ field, from: oldVal === undefined ? undefined : String(oldVal), to: String(newVal) });
          (existing as unknown as Record<string, unknown>)[field] = newVal;
        }
      }

      // 'auctionClose' is a value parsed/derived from 'auctionCloseRaw', re-parsed fresh
      // on every upload. It's kept in sync here unconditionally rather than through the
      // comparableFields loop above because it is not itself an independent business
      // fact — 'auctionCloseRaw' (compared above) is. Comparing the derived value
      // directly is unreliable once it round-trips through the database: this app's
      // schema stores auction_close as a DATE column, so a value read back from
      // Supabase has no time-of-day component, while a value freshly computed by
      // parseDateFlexible() is a full ISO timestamp. Re-uploading the exact same
      // unchanged file would then make every record with a parseable date look
      // "changed" on the second and every later upload, even though nothing about
      // the auction actually changed. Refreshing the field without treating a mere
      // representation mismatch as a change avoids that false positive while still
      // keeping 'auctionClose' from ever going stale relative to 'auctionCloseRaw'.
      if (candidateFields.auctionClose !== undefined) {
        existing.auctionClose = candidateFields.auctionClose;
      }

      for (const [k, v] of Object.entries(extra)) {
        if (existing.extra[k] !== v) {
          changedFields.push({ field: `extra.${k}`, from: existing.extra[k], to: v });
          existing.extra[k] = v;
        }
      }

      existing.lastSeenAt = now;
      if (!existing.sourceFiles.includes(fileName)) existing.sourceFiles.push(fileName);

      if (changedFields.length > 0) {
        existing.lastUpdatedAt = now;
        existing.history.push({ timestamp: now, sourceFile: fileName, changedFields });
        recordsUpdated++;
      } else {
        recordsUnchanged++;
      }
    }
  }

  if (blankFacilityRows.length > 0) {
    warnings.push({ severity: 'warning', message: `${blankFacilityRows.length} row(s) had a blank Facility value.`, rowNumbers: blankFacilityRows });
  }
  if (blankUnitRows.length > 0) {
    warnings.push({ severity: 'warning', message: `${blankUnitRows.length} row(s) had a blank Unit value.`, rowNumbers: blankUnitRows });
  }
  if (invalidDateRows.length > 0) {
    warnings.push({ severity: 'warning', message: `${invalidDateRows.length} row(s) had an Auction Close value that could not be parsed as a date.`, rowNumbers: invalidDateRows });
  }
  if (unexpectedStatuses.size > 0) {
    warnings.push({ severity: 'warning', message: `New/unrecognized status value(s) found and preserved as-is: ${Array.from(unexpectedStatuses).join(', ')}.` });
  }
  for (const [key, rowNums] of rowKeysInThisFile) {
    if (rowNums.length > 1) {
      warnings.push({ severity: 'warning', message: `${rowNums.length} rows in this file resolved to the same auction (key: ${key}); later rows updated the same record instead of creating duplicates.`, rowNumbers: rowNums });
    }
  }
  if (rowsSkipped > 0) {
    warnings.push({ severity: 'error', message: `${rowsSkipped} row(s) skipped: no Facility or Unit value to identify the auction.` });
  }
  if (unmappedColumns.length > 0) {
    warnings.push({ severity: 'warning', message: `${unmappedColumns.length} column(s) not recognized as standard LockerFox fields; preserved as additional details: ${unmappedColumns.join(', ')}.` });
  }
  if (preexistingDuplicateIdentities.size > 0) {
    warnings.push({
      severity: 'warning',
      message: `${preexistingDuplicateIdentities.size} auction(s) already have more than one stored record for the same facility, unit and close date (left over from the earlier timezone-dependent key). The most recently seen copy of each was kept up to date; the extra copies were left untouched and should be merged with the one-time cleanup.`,
    });
  }
  if (nearDuplicateMatches > 0) {
    warnings.push({
      severity: 'warning',
      message: `${nearDuplicateMatches} row(s) matched an existing record for the same facility and unit whose stored close time differs by less than 24 hours (the same auction with a timezone-shifted close time); that record was updated instead of creating a duplicate.`,
    });
  }

  const newDataset: Dataset = {
    records: Array.from(recordsByKey.values()),
    uploads: dataset.uploads,
  };

  const result: UploadResult = {
    id: `upload_${now}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: now,
    fileName,
    totalRowsInFile: rows.length,
    recordsAdded,
    recordsUpdated,
    recordsUnchanged,
    rowsSkipped,
    warnings,
    detectedColumns: mapping,
    unmappedColumns,
  };

  newDataset.uploads = [result, ...dataset.uploads];

  return { dataset: newDataset, result };
}
