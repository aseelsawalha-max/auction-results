import type { AuctionRecord, Dataset, UploadResult, UploadWarning, CanonicalField } from './types';
import type { ParsedRow } from './parseExcel';
import { parseDateFlexible, parseNumberFlexible, normalizeKeyPart } from './normalize';

const KNOWN_STATUSES = new Set(['SOLD', 'PICKED-UP', 'PICKED UP', 'UNSOLD', 'VOID', 'VOIDED', 'CANCELED', 'CANCELLED']);

function buildDedupeKey(
  auctionId: string | undefined,
  facility: string | undefined,
  unit: string | undefined,
  auctionCloseRaw: string | undefined,
): { key: string; isNativeId: boolean } {
  if (auctionId && auctionId.trim()) {
    return { key: `id:${normalizeKeyPart(auctionId)}`, isNativeId: true };
  }
  return {
    key: `composite:${normalizeKeyPart(facility)}|${normalizeKeyPart(unit)}|${normalizeKeyPart(auctionCloseRaw)}`,
    isNativeId: false,
  };
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

  const recordsByKey = new Map(dataset.records.map((r) => [r.dedupeKey, r] as const));

  let recordsAdded = 0;
  let recordsUpdated = 0;
  let recordsUnchanged = 0;
  let rowsSkipped = 0;
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

    const { key, isNativeId } = buildDedupeKey(auctionId, facility, unit, auctionCloseRaw);

    const existingRowsForKey = rowKeysInThisFile.get(key) ?? [];
    existingRowsForKey.push(row.rowNumber);
    rowKeysInThisFile.set(key, existingRowsForKey);

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

    const existing = recordsByKey.get(key);

    if (!existing) {
      const record: AuctionRecord = {
        dedupeKey: key,
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
      recordsByKey.set(key, record);
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
