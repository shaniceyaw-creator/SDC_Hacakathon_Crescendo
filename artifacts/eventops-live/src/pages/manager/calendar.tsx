import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useGetCalendar, getGetCalendarQueryKey, type EventSummary } from '@workspace/api-client-react';
import { day, time12 } from '@/lib/format';
import { addDays } from '@/lib/booking';
import { PageHead, Skeleton, ErrorState, Empty } from '@/components/manager/common';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const LABEL: Record<string, [string, string]> = { Approved: ['Confirmed', 'approved'], Pending: ['Waiting for review', 'pending'], Completed: ['Completed', 'completed'] };
const kind = (e: EventSummary) => LABEL[e.status] ?? [e.status_label, 'completed'];

function Ev({ e }: { e: EventSummary }) {
  const [label, cls] = kind(e);
  const text = `${time12(e.start_time)}–${time12(e.end_time)} ${e.name}`;
  return e.id.startsWith('EV-') && e.source !== 'history'
    ? <Link href={`/manager/events/${e.id}`} className={`mg-ev ${cls}`} title={`${e.name} · ${label}`} data-testid={`link-cal-event-${e.id}`}>{text}</Link>
    : <span className={`mg-ev ${cls}`} title={`${e.name} · ${label}`} data-testid={`text-cal-event-${e.id}`}>{text}</span>;
}

export default function CalendarPage() {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const first = month;
  const gridStart = new Date(first); gridStart.setDate(1 - ((first.getDay() + 6) % 7));
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const params = { from: iso(cells[0]), to: iso(cells[41]) };
  const q = useGetCalendar(params, { query: { queryKey: getGetCalendarQueryKey(params) } });
  const byDay = useMemo(() => {
    const m = new Map<string, EventSummary[]>();
    (q.data?.events ?? []).filter((e) => e.status !== 'Declined' && e.status !== 'Cancelled').forEach((e) => { const end = (e.end_date ?? e.date).slice(0, 10); for (let k = e.date.slice(0, 10), n = 0; k <= end && n < 32; k = addDays(k, 1), n++) m.set(k, [...(m.get(k) ?? []), e]); });
    m.forEach((l) => l.sort((a, b) => a.start_time.localeCompare(b.start_time)));
    return m;
  }, [q.data]);
  const today = iso(new Date());
  const monthEvents = cells.filter((c) => c.getMonth() === first.getMonth()).flatMap((c) => (byDay.get(iso(c)) ?? []));
  const shift = (n: number) => setMonth(new Date(first.getFullYear(), first.getMonth() + n, 1));

  return (
    <div className="mg-page">
      <PageHead title="Calendar" action={
        <div className="mg-cal-nav">
          <button className="eo-btn" onClick={() => shift(-1)} aria-label="Previous month" data-testid="button-prev-month"><ChevronLeft size={16} /></button>
          <h2 data-testid="text-month">{first.toLocaleDateString('en-MY', { month: 'long', year: 'numeric' })}</h2>
          <button className="eo-btn" onClick={() => shift(1)} aria-label="Next month" data-testid="button-next-month"><ChevronRight size={16} /></button>
          <button className="eo-btn" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }} data-testid="button-today">Today</button>
        </div>
      } />
      <div className="mg-legend">
        <span><i style={{ background: 'var(--eo-teal)' }} />Confirmed</span>
        <span><i style={{ background: '#e98a6a' }} />Waiting for review</span>
        <span><i style={{ background: '#a6ae9a' }} />Completed</span>
      </div>
      {q.isLoading ? <Skeleton rows={7} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <div className="mg-cal" data-testid="grid-calendar">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="mg-cal-dow">{d}</div>)}
            {cells.map((c) => {
              const k = iso(c); const list = byDay.get(k) ?? [];
              return (
                <div key={k} className={`mg-cal-cell${c.getMonth() !== first.getMonth() ? ' out' : ''}${k === today ? ' today' : ''}`} data-testid={`cell-day-${k}`}>
                  <span className="mg-cal-num">{c.getDate()}</span>
                  {list.slice(0, 3).map((e) => <Ev key={e.id} e={e} />)}
                  {list.length > 3 && <small className="mg-muted">+{list.length - 3} more</small>}
                </div>
              );
            })}
          </div>
          <div className="mg-cal-list mg-card">
            {monthEvents.length === 0 ? <Empty title="No events this month" /> : (
              <ul className="mg-list">
                {monthEvents.map((e) => (
                  <li key={e.id} style={{ flexDirection: 'column', gap: 4 }}>
                    <small>{day(e.date)} · {e.area} · {kind(e)[0]}</small>
                    <Ev e={e} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
