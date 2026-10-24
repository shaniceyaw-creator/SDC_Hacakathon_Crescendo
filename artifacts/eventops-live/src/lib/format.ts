// Shared display helpers. Dates from the API are plain YYYY-MM-DD strings in Malaysia time.

export const rm = (value: number | null | undefined) =>
  value == null ? '–' : `RM ${Math.round(value).toLocaleString('en-MY')}`;

export const rmRange = (low: number, high: number) => `RM ${low.toLocaleString('en-MY')} – ${high.toLocaleString('en-MY')}`;

const parse = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`);

export const day = (iso: string) =>
  parse(iso).toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

export const shortDay = (iso: string) => parse(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' });

export const monthName = (iso: string) => parse(iso).toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });

export const daysFrom = (fromIso: string, toIso: string) =>
  Math.round((parse(toIso).getTime() - parse(fromIso).getTime()) / 86_400_000);

export const time12 = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
};

export const ROLE_LABEL: Record<string, string> = {
  Event_Coordinators: 'Coordinators',
  AV_Technicians: 'AV technicians',
  Logistics_Crew: 'Logistics crew',
  Safety_Officers: 'Safety officers',
};

/** Cover picture for each event type (public/clipart). */
const CLIPART: Record<string, string> = {
  'Birthday / Private Party': 'birthday',
  'Conference / Seminar': 'conference',
  'Corporate Annual Dinner': 'annual-dinner',
  'Exhibition / Roadshow': 'roadshow',
  'Family Day': 'family-day',
  'Festive Open House': 'open-house',
  'Fun Run / Charity Run': 'fun-run',
  'Product Launch': 'product-launch',
  'Wedding Reception': 'wedding',
};

export const clipart = (eventType: string) =>
  `${import.meta.env.BASE_URL}clipart/${CLIPART[eventType] ?? 'family-day'}.jpg`;
