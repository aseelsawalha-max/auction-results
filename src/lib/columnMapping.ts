import type { CanonicalField } from './types';

// Each canonical field maps to a list of header aliases we recognize.
// Matching is case/whitespace/punctuation-insensitive (see normalizeHeader).
const FIELD_ALIASES: Record<CanonicalField, string[]> = {
  auctionId: [
    'auction id', 'auctionid', 'lockerfox id', 'lockerfox auction id', 'id',
    'auction #', 'auction number', 'listing id', 'unique id', 'record id',
  ],
  auctionClose: [
    'auction close', 'auction close date', 'close date', 'closed', 'closing date',
    'auction date', 'date closed', 'end date', 'auction end', 'auction end date',
  ],
  facility: [
    'facility', 'facility name', 'location', 'site', 'store', 'property',
  ],
  unit: [
    'unit', 'unit #', 'unit number', 'unit no', 'space', 'space number', 'unit name',
  ],
  status: [
    'status', 'auction status', 'result', 'outcome', 'final status',
  ],
  attendees: [
    'attendees', 'attendee count', 'bidders', 'number of attendees', '# attendees',
  ],
  views: [
    'views', 'view count', 'number of views', '# views',
  ],
  bid: [
    'bid', 'winning bid', 'final bid', 'high bid', 'sale price', 'amount', 'bid amount',
  ],
  winner: [
    'winner', 'winning bidder', 'buyer', 'bidder', 'winner name',
  ],
  voidReasonCode: [
    'void reason code', 'void reason', 'void code',
  ],
  cancelReasonCode: [
    'cancel reason code', 'cancel reason', 'canceled reason code', 'cancellation reason code', 'cancel code',
  ],
};

export function normalizeHeader(header: string): string {
  return header
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9# ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Maps raw file headers to canonical fields. Returns the mapping plus any headers left unmapped. */
export function detectColumns(headers: string[]): {
  mapping: Partial<Record<CanonicalField, string>>;
  unmapped: string[];
} {
  const mapping: Partial<Record<CanonicalField, string>> = {};
  const unmapped: string[] = [];

  const normalizedHeaders = headers.map((h) => ({ raw: h, normalized: normalizeHeader(h) }));

  for (const field of Object.keys(FIELD_ALIASES) as CanonicalField[]) {
    const aliases = FIELD_ALIASES[field];
    const match = normalizedHeaders.find((h) => aliases.includes(h.normalized));
    if (match) {
      mapping[field] = match.raw;
    }
  }

  const mappedRaw = new Set(Object.values(mapping));
  for (const h of headers) {
    if (!mappedRaw.has(h)) unmapped.push(h);
  }

  return { mapping, unmapped };
}
