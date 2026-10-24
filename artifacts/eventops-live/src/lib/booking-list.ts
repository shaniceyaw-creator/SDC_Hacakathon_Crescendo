import type { EventSummary } from '@workspace/api-client-react';

export type Period = 'all' | '30';
export type SortOrder = 'asc' | 'desc';
export type GroupBy = 'date' | 'type' | 'none';
export interface ListState { period: Period; type: string; sort: SortOrder; group: GroupBy }
export interface BookingGroup { key: string; label: string; items: EventSummary[] }

export const DEFAULT_STATE: ListState = { period: 'all', type: 'all', sort: 'asc', group: 'date' };

/** Stable per-type palette: dark text on tinted fill (all >= 4.5:1). */
export const TYPE_TONES: Record<string, { fg: string; bg: string; bar: string }> = {
  'Birthday / Private Party': { fg: '#8a2f4f', bg: '#fbe3ea', bar: '#e0708f' },
  'Conference / Seminar': { fg: '#1f4e79', bg: '#dfeaf7', bar: '#4f8fd0' },
  'Corporate Annual Dinner': { fg: '#5b3a8c', bg: '#ebe2f8', bar: '#8d6bd0' },
  'Exhibition / Roadshow': { fg: '#7a4a05', bg: '#fbebc9', bar: '#e0a22a' },
  'Family Day': { fg: '#1d6149', bg: '#dcf2e6', bar: '#47b383' },
  'Festive Open House': { fg: '#8a3b12', bg: '#fde3d3', bar: '#e98550' },
  'Fun Run / Charity Run': { fg: '#0f5e66', bg: '#d6f0f2', bar: '#37aab5' },
  'Product Launch': { fg: '#5c6b0f', bg: '#eaf0c8', bar: '#a3b82f' },
  'Wedding Reception': { fg: '#7d2a2a', bg: '#f6dcdc', bar: '#c9585a' },
};
const FALLBACK = { fg: '#3d4f48', bg: '#e8ece4', bar: '#8a9a90' };
export const toneFor = (t: string) => TYPE_TONES[t] ?? FALLBACK;

const day = (s: string) => s.slice(0, 10);

export function readState(search: string): ListState {
  const p = new URLSearchParams(search);
  const g = p.get('group');
  return {
    period: p.get('period') === '30' ? '30' : 'all',
    type: p.get('type') || 'all',
    sort: p.get('sort') === 'desc' ? 'desc' : 'asc',
    group: g === 'type' || g === 'none' ? g : 'date',
  };
}

export function toSearch(s: ListState): string {
  const p = new URLSearchParams();
  if (s.period !== 'all') p.set('period', s.period);
  if (s.type !== 'all') p.set('type', s.type);
  if (s.sort !== 'asc') p.set('sort', s.sort);
  if (s.group !== 'date') p.set('group', s.group);
  const r = p.toString();
  return r ? `?${r}` : '';
}

export function filterBookings(list: EventSummary[], s: Pick<ListState, 'period' | 'type'>, today: string, to: string): EventSummary[] {
  return list.filter((e) => {
    if (s.type !== 'all' && e.event_type !== s.type) return false;
    if (s.period === '30') return day(e.end_date ?? e.date) >= today && day(e.date) <= to;
    return true;
  });
}

export function sortBookings(list: EventSummary[], order: SortOrder): EventSummary[] {
  const k = order === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => k * (day(a.date).localeCompare(day(b.date)) || a.start_time.localeCompare(b.start_time) || a.name.localeCompare(b.name)));
}

export function dayLabel(iso: string): string {
  return new Date(`${day(iso)}T00:00:00Z`).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Keep the chosen date order within groups; type headings are alphabetical. */
export function groupBookings(list: EventSummary[], by: GroupBy): BookingGroup[] {
  if (by === 'none') return list.length ? [{ key: 'all', label: '', items: list }] : [];
  const m = new Map<string, BookingGroup>();
  for (const e of list) {
    const key = by === 'date' ? day(e.date) : e.event_type;
    let g = m.get(key);
    if (!g) { g = { key, label: by === 'date' ? dayLabel(key) : key, items: [] }; m.set(key, g); }
    g.items.push(e);
  }
  const groups = [...m.values()];
  return by === 'type' ? groups.sort((a, b) => a.label.localeCompare(b.label)) : groups;
}

export const typesIn = (list: EventSummary[]) => [...new Set(list.map((e) => e.event_type))].sort();
