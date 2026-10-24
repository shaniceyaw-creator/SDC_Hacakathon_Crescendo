import type { Options, EventInput } from '@workspace/api-client-react';
import { day, time12 } from '@/lib/format';
import { endsNextDay } from '@/lib/shift-time';

export const DEMO_EMAIL = 'hello@opusevents.example';
export type Role = 'manager' | 'customer';
const LIMITS = { manager: { min: 10, max: 5000 }, customer: { min: 10, max: 1000 } } as const;
export const guestLimits = (r: Role) => LIMITS[r];

const pad = (n: number) => String(n).padStart(2, '0');
export const todayMYT = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
export const isIsoDay = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso)
  && Number.isFinite(Date.parse(`${iso}T00:00:00Z`))
  && new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso;
export const addDays = (iso: string, n: number) => {
  // Native date fields can emit incomplete/extended years while being edited.
  // Do not call toISOString until the value is a complete, supported ISO date.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + n);
  return d.getUTCFullYear() <= 9999 ? d.toISOString().slice(0, 10) : '';
};
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
export const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const earliestOf = (o: Options) => o.earliest_booking_date ?? addDays(todayMYT(), 7);

/** Template start + duration, capped at 23:59 (never wraps past midnight). */
export function defaultEnd(start: string, duration: number) {
  const m = Math.min(mins(start) + Math.round(duration * 60), 23 * 60 + 59);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export type BookingForm = {
  event_type: string; venue_name: string; guests: string; area: string; venue_type: string; seating_style: string;
  service_level: string; open_to_public: boolean; special_request: string;
  date: string; end_date: string; start_time: string; end_time: string;
};

function typeDefaults(o: Options, name: string, role: Role) {
  const t = o.event_types.find((x) => x.name === name);
  const start = `${pad(t?.start_hour ?? 10)}:00`;
  const { min, max } = guestLimits(role);
  const mid = t ? Math.round((t.guests.min + t.guests.max) / 2) : 100;
  return {
    venue_type: t?.venue_type ?? '', seating_style: t?.seating_style ?? '', start_time: start,
    end_time: defaultEnd(start, t?.duration_hours ?? 4), guests: String(Math.min(max, Math.max(min, mid))),
  };
}

export function defaultsFor(o: Options, role: Role): BookingForm {
  const earliest = earliestOf(o); const want = addDays(todayMYT(), 30);
  const date = want < earliest ? earliest : want;
  const name = o.event_types[0]?.name ?? '';
  return {
    event_type: name, venue_name: '', area: o.areas[0]?.name ?? '', service_level: o.service_levels[0] ?? '',
    open_to_public: false, special_request: '', date, end_date: date, ...typeDefaults(o, name, role),
  };
}
export const applyType = (o: Options, f: BookingForm, name: string, role: Role): BookingForm => ({ ...f, event_type: name, ...typeDefaults(o, name, role) });

export function changeStartDate(f: BookingForm, date: string, o: Options): BookingForm {
  // While a native date field is being typed, transient years must not be
  // copied into the end-date field. Couple only complete bookable dates.
  if (!isIsoDay(date) || date < earliestOf(o) || date > addDays(todayMYT(), 730)) return { ...f, date };
  const end = isIsoDay(f.end_date) && f.end_date >= date && f.end_date <= addDays(date, 30) ? f.end_date : date;
  return { ...f, date, end_date: end };
}

export function checkBooking(f: BookingForm, o: Options, role: Role) {
  const errors: string[] = []; const earliest = earliestOf(o); const { min, max } = guestLimits(role);
  const guests = Number(f.guests);
  const validDates = isIsoDay(f.date) && isIsoDay(f.end_date);
  const days = validDates ? dayDiff(f.date, f.end_date) + 1 : 0;
  const dailyHours = f.start_time && f.end_time ? (mins(f.end_time) - mins(f.start_time)) / 60 : 0;
  if (!validDates) errors.push('Please choose valid start and end dates.');
  else {
    if (f.date < earliest) errors.push(`Bookings need one week's notice. The earliest date is ${day(earliest)}.`);
    if (f.date > addDays(todayMYT(), 730)) errors.push('Bookings can be made up to two years ahead.');
    if (f.end_date < f.date) errors.push('The end date cannot be before the start date.');
    else if (days > 31) errors.push('An event can run for 31 days at most.');
  }
  if (f.start_time && f.end_time && dailyHours <= 0) errors.push('The end time must be after the start time. Events run the same hours each day and do not continue overnight.');
  if (!(guests >= min)) errors.push(`Guests must be at least ${min}.`);
  let contact = false;
  if (role === 'customer') contact = guests > max || dailyHours > 14 || days > 31;
  else {
    if (guests > max) errors.push(`Guests cannot be more than ${max.toLocaleString('en-MY')}.`);
    if (dailyHours > 14) errors.push('Daily hours cannot be more than 14.');
  }
  return { errors, contact, dailyHours, days, earliest };
}

export const toInput = (f: BookingForm): Omit<EventInput, 'name'> => ({
  event_type: f.event_type, date: f.date, end_date: f.end_date, start_time: f.start_time, end_time: f.end_time,
  venue_name: f.venue_name.trim() || undefined, guests: Number(f.guests), area: f.area, venue_type: f.venue_type,
  seating_style: f.seating_style, service_level: f.service_level, open_to_public: f.open_to_public,
  special_request: f.special_request.trim() || undefined,
});

type Span = { date: string; end_date?: string | null; start_time: string; end_time?: string | null };
export function fmtDates(e: Span) {
  return e.end_date && e.end_date.slice(0, 10) !== e.date.slice(0, 10) ? `${day(e.date)} to ${day(e.end_date)}` : day(e.date);
}
export function fmtTimes(e: Span) {
  const t = `${time12(e.start_time)}${e.end_time ? `–${time12(e.end_time)}` : ''}`;
  return e.end_date && e.end_date.slice(0, 10) !== e.date.slice(0, 10) ? `${t} daily` : t;
}
export const shiftEnd = (e: object) => (e as { shift_end_time?: string | null }).shift_end_time ?? null;
export function fmtWorkerShift(e: { report_time: string; shift_end_time?: string | null }) {
  const end = shiftEnd(e);
  return `${time12(e.report_time)}${end ? ` – ${time12(end)}${endsNextDay(e.report_time, end) ? ' (next day)' : ''}` : ''}`;
}
export const fmtRange = (e: Span) => `${fmtDates(e)} · ${fmtTimes(e)}`;
