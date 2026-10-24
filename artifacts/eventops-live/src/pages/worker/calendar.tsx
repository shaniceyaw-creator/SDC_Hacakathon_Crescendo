import { useMemo, useState } from 'react';
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Download, MapPin } from 'lucide-react';
import { useGetCalendar, getGetCalendarQueryKey, useGetWorkerHome, getGetWorkerHomeQueryKey, type EventSummary } from '@workspace/api-client-react';
import { addDays, fmtDates, fmtWorkerShift } from '@/lib/booking';
import { downloadIcs, googleCalendarUrl } from '@/lib/calendar-links';
import { day, ROLE_LABEL } from '@/lib/format';
import { Empty, ErrorState, PageHead, Skel } from '@/components/people/bits';
import '@/styles/people.css';
import '@/styles/worker-calendar.css';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shiftText = (e: EventSummary) => fmtWorkerShift({ report_time: e.report_time ?? e.start_time, shift_end_time: e.shift_end_time ?? e.end_time });
const cls = (e: EventSummary) => (e.status === 'Pending' ? 'pending' : e.status === 'Completed' ? 'completed' : '');

export default function WorkerCalendar() {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selDay, setSelDay] = useState<string | null>(null);
  const [selEv, setSelEv] = useState<string | null>(null);
  const gridStart = new Date(month); gridStart.setDate(1 - ((month.getDay() + 6) % 7));
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const params = { from: iso(cells[0]), to: iso(cells[41]) };
  const q = useGetCalendar(params, { query: { queryKey: getGetCalendarQueryKey(params), refetchInterval: 30000 } });
  const home = useGetWorkerHome({ query: { queryKey: getGetWorkerHomeQueryKey(), refetchInterval: 30000 } });
  const jobs = home.data?.jobs;

  const byDay = useMemo(() => {
    const m = new Map<string, EventSummary[]>();
    (q.data?.events ?? []).filter((e) => e.status !== 'Declined' && e.status !== 'Cancelled').forEach((e) => {
      const end = (e.end_date ?? e.date).slice(0, 10);
      for (let k = e.date.slice(0, 10), n = 0; k <= end && n < 62; k = addDays(k, 1), n++) m.set(k, [...(m.get(k) ?? []), e]);
    });
    m.forEach((l) => l.sort((a, b) => (a.report_time ?? a.start_time).localeCompare(b.report_time ?? b.start_time)));
    return m;
  }, [q.data]);

  const today = iso(new Date());
  const monthCount = cells.filter((c) => c.getMonth() === month.getMonth()).reduce((n, c) => n + (byDay.get(iso(c))?.length ?? 0), 0);
  const shift = (n: number) => { setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1)); setSelDay(null); setSelEv(null); };
  const detail = selDay ? (byDay.get(selDay) ?? []).filter((e) => !selEv || e.id === selEv) : [];

  return (
    <div className="pp-page">
      <PageHead kicker="Calendar" title="My job calendar" sub="Times show your reporting time to your shift finish."
        action={jobs && jobs.length > 0 ? <button className="eo-btn eo-btn-primary pp-big" onClick={() => downloadIcs(jobs)} data-testid="button-download-ics"><Download size={17} />Download all ({jobs.length})</button> : undefined} />
      <div className="wc-nav">
        <button className="eo-btn" onClick={() => shift(-1)} aria-label="Previous month" data-testid="button-prev-month"><ChevronLeft size={16} /></button>
        <h2 data-testid="text-month" aria-live="polite">{month.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })}</h2>
        <button className="eo-btn" onClick={() => shift(1)} aria-label="Next month" data-testid="button-next-month"><ChevronRight size={16} /></button>
        <button className="eo-btn" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelDay(null); setSelEv(null); }} data-testid="button-today">Today</button>
      </div>
      {q.isLoading ? <Skel rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <div className="wc-scroll" data-testid="grid-calendar">
            <div className="wc-grid">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="wc-dow">{d}</div>)}
              {cells.map((c) => {
                const k = iso(c); const list = byDay.get(k) ?? [];
                return (
                  <div key={k} className={`wc-cell${c.getMonth() !== month.getMonth() ? ' out' : ''}${k === today ? ' today' : ''}${k === selDay ? ' sel' : ''}`} data-testid={`cell-day-${k}`}>
                    <button className="wc-num" onClick={() => { setSelDay(k); setSelEv(null); }} aria-label={`${day(k)}${k === today ? ', today' : ''}, ${list.length} jobs`} aria-current={k === today ? 'date' : undefined}>{c.getDate()}</button>
                    {list.slice(0, 3).map((e) => (
                      <button key={e.id} className={`wc-ev ${cls(e)}${k === selDay && e.id === selEv ? ' on' : ''}`} title={`${e.name} · ${shiftText(e)}`} onClick={() => { setSelDay(k); setSelEv(e.id); }} data-testid={`button-cal-event-${e.id}-${k}`}>
                        <strong className="wc-ev-name">{e.name}</strong>
                        <span className="wc-ev-time">{shiftText(e).replace(' (next day)', ' (+1 day)')}</span>
                      </button>
                    ))}
                    {list.length > 3 && <button className="wc-more wc-num" onClick={() => { setSelDay(k); setSelEv(null); }}>+{list.length - 3} more</button>}
                  </div>
                );
              })}
            </div>
          </div>
          {monthCount === 0 && <div data-testid="text-empty-month"><Empty icon={<CalendarDays size={22} />} title="No jobs this month" text="Approved jobs assigned to you appear on their days." /></div>}
          {selDay && (
            <section className="wc-detail" aria-live="polite" data-testid="panel-day-detail">
              <h2 className="pp-h2">{day(selDay)}</h2>
              {detail.length === 0 ? <p className="wc-msg">Nothing assigned on this day.</p> : detail.map((e) => (
                <div className="wc-detail-item" key={e.id} data-testid={`row-cal-job-${e.id}`}>
                  <div style={{ minWidth: 0 }}>
                    <h3>{e.name}</h3>
                    <div className="pp-meta" style={{ marginTop: 4 }}>
                      <span>{fmtDates(e)}</span>
                      <span className="pp-report">Shift {shiftText(e)}</span>
                      <span><MapPin size={13} />{e.venue_name ? `${e.venue_name}, ` : ''}{e.area}</span>
                      {e.my_role && <span>{ROLE_LABEL[e.my_role] ?? e.my_role}</span>}
                    </div>
                  </div>
                  <a className="eo-btn" href={googleCalendarUrl(e)} target="_blank" rel="noreferrer" data-testid={`link-gcal-${e.id}`}><CalendarPlus size={15} />Add to Google Calendar</a>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
