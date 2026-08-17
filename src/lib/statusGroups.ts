/**
 * Groups raw LockerFox status strings into logical buckets for KPI/summary display.
 * The original status string is never altered — this is purely a display-time grouping,
 * and any status we don't recognize falls into "Other" rather than being dropped.
 */
export type StatusGroup = 'Sold' | 'Picked Up' | 'Unsold' | 'Voided' | 'Canceled' | 'Other';

export function groupStatus(status: string | undefined): StatusGroup {
  const s = (status ?? '').trim().toUpperCase();
  if (s === 'SOLD') return 'Sold';
  if (s === 'PICKED-UP' || s === 'PICKED UP' || s === 'PICKEDUP') return 'Picked Up';
  if (s === 'UNSOLD') return 'Unsold';
  if (s === 'VOID' || s === 'VOIDED') return 'Voided';
  if (s === 'CANCELED' || s === 'CANCELLED') return 'Canceled';
  return 'Other';
}

export const STATUS_GROUP_ORDER: StatusGroup[] = ['Sold', 'Picked Up', 'Unsold', 'Voided', 'Canceled', 'Other'];
