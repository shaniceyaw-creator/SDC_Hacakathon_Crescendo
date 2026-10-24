import type { Options } from '@workspace/api-client-react';
import { AlertTriangle, CalendarClock, Info } from 'lucide-react';
import { DEMO_EMAIL, addDays, checkBooking, earliestOf, guestLimits, type BookingForm, type Role } from '@/lib/booking';
import { day } from '@/lib/format';
import '@/styles/bookings.css';

type Props = {
  o: Options; f: BookingForm; role: Role;
  set: <K extends keyof BookingForm>(k: K, v: BookingForm[K]) => void;
  onType: (name: string) => void; onStart: (date: string) => void;
};

export function ContactNotice({ o }: { o: Options }) {
  const mail = o.contact_email ?? DEMO_EMAIL;
  return (
    <div className="eo-notice bk-contact" role="status" data-testid="notice-contact">
      <AlertTriangle size={16} />
      <div>
        <strong>This size of booking needs a conversation first.</strong>
        <p>Bookings above 1,000 guests, or longer than 14 hours a day, are arranged directly. Write to <b>{mail}</b>.</p>
        <p className="bk-fine">{o.contact_note ?? 'Demo address only. It is not a real inbox and nobody monitors it.'}</p>
      </div>
    </div>
  );
}

/** Same fields, options and defaults for the manager and customer booking forms. */
export function BookingFields({ o, f, role, set, onType, onStart }: Props) {
  const earliest = earliestOf(o); const { min, max } = guestLimits(role);
  const c = checkBooking(f, o, role);
  const type = o.event_types.find((x) => x.name === f.event_type);
  const guests = Number(f.guests);
  return (
    <div className="bk-grid">
      <label className="eo-field">Event type
        <select value={f.event_type} onChange={(e) => onType(e.target.value)} data-testid="select-event-type">
          {o.event_types.map((t) => <option key={t.name}>{t.name}</option>)}
        </select>
      </label>
      <label className="eo-field">Venue name (optional)
        <input maxLength={200} value={f.venue_name} onChange={(e) => set('venue_name', e.target.value)} placeholder="e.g. Dewan Seri Melati" data-testid="input-venue-name" />
      </label>

      <fieldset className="bk-sched full">
        <legend><CalendarClock size={14} />When</legend>
        <label className="eo-field">Start date
          <input type="date" required min={earliest} value={f.date} onChange={(e) => onStart(e.target.value)} data-testid="input-date" />
        </label>
        <label className="eo-field">End date
          <input type="date" required min={f.date || earliest} max={f.date ? addDays(f.date, 30) : undefined} value={f.end_date} onChange={(e) => set('end_date', e.target.value)} data-testid="input-end-date" />
        </label>
        <label className="eo-field">Start time
          <input type="time" required value={f.start_time} onChange={(e) => set('start_time', e.target.value)} data-testid="input-start-time" />
        </label>
        <label className="eo-field">End time
          <input type="time" required value={f.end_time} onChange={(e) => set('end_time', e.target.value)} data-testid="input-end-time" />
        </label>
        <p className="bk-fine full">
          <Info size={12} /> One week's notice is needed: the earliest start is {day(earliest)}. The same hours apply on every day, up to 31 days and 14 hours a day, finishing the same evening.
          {c.dailyHours > 0 && c.days > 0 && <> That is <b>{c.dailyHours.toLocaleString('en-MY', { maximumFractionDigits: 1 })} h</b> a day for <b>{c.days}</b> day{c.days === 1 ? '' : 's'}.</>}
        </p>
      </fieldset>

      <label className="eo-field">Guests{type && <small className="mg-muted">usually {type.guests.min}–{type.guests.max}</small>}
        <input type="number" required min={min} max={role === 'manager' ? max : undefined} value={f.guests} onChange={(e) => set('guests', e.target.value)} data-testid="input-guests" />
      </label>
      <label className="eo-field">Area
        <select value={f.area} onChange={(e) => set('area', e.target.value)} data-testid="select-area">
          {o.areas.map((a) => <option key={a.name} value={a.name}>{a.name}, {a.state}</option>)}
        </select>
      </label>
      <label className="eo-field">Venue type
        <select value={f.venue_type} onChange={(e) => set('venue_type', e.target.value)} data-testid="select-venue-type">
          {o.venue_types.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.setting})</option>)}
        </select>
      </label>
      <label className="eo-field">Seating
        <select value={f.seating_style} onChange={(e) => set('seating_style', e.target.value)} data-testid="select-seating">
          {o.seating_styles.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      <label className="eo-field">Service level
        <select value={f.service_level} onChange={(e) => set('service_level', e.target.value)} data-testid="select-service-level">
          {o.service_levels.map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      <label className="eo-field">Who can attend
        <select value={f.open_to_public ? 'public' : 'private'} onChange={(e) => set('open_to_public', e.target.value === 'public')} data-testid="select-public">
          <option value="private">Private, invited guests only</option>
          <option value="public">Public, open to everyone</option>
        </select>
      </label>
      {role === 'manager' && guests > 1000 && (
        <div className="eo-notice full" data-testid="notice-special"><AlertTriangle size={16} />Above 1,000 guests this is a special booking. Check venue permits, extra safety officers and supplier lead times before approving.</div>
      )}
      <label className="eo-field full">Special request
        <textarea rows={3} value={f.special_request} onChange={(e) => set('special_request', e.target.value)} placeholder="Optional" data-testid="input-special-request" />
      </label>
      {role === 'customer' && c.contact && <div className="full"><ContactNotice o={o} /></div>}
    </div>
  );
}
