import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ArrowRight, Users, Repeat, AlertTriangle, CalendarClock } from 'lucide-react';
import {
  useGetManagerDashboard, useDecideEvent, getGetManagerDashboardQueryKey, type ManagerDashboard, type PendingRequest,
} from '@workspace/api-client-react';
import { fmtRange } from '@/lib/booking';
import { rm, rmRange, day, shortDay, time12, clipart } from '@/lib/format';
import { PageHead, Skeleton, ErrorState, Empty, LeaveCard, errorText } from '@/components/manager/common';

function SeasonStrip({ d }: { d: ManagerDashboard }) {
  const { strip, season } = d;
  const total = strip.days.length || 1;
  const idx = useMemo(() => new Map(strip.days.map((x, i) => [x.date, i])), [strip.days]);
  const max = Math.max(1, ...strip.days.map((x) => x.confirmed + x.pending));
  const pos = (iso: string) => {
    const i = idx.get(iso);
    if (i != null) return (i / total) * 100;
    return iso < strip.days[0]?.date ? 0 : 100;
  };
  const months = useMemo(() => {
    const out: { label: string; w: number }[] = [];
    strip.days.forEach((x) => {
      const label = new Date(`${x.date}T00:00:00`).toLocaleDateString('en-MY', { month: 'short' });
      if (out.length && out[out.length - 1].label === label) out[out.length - 1].w++; else out.push({ label, w: 1 });
    });
    return out;
  }, [strip.days]);
  return (
    <section className="mg-season" data-testid="card-season">
      <div className="mg-season-top">
        <div>
          <p className="mg-eyebrow">Year ahead</p>
          {season.label ? (
            <h2 data-testid="text-season-alert">
              {season.active ? `${season.label} is on now` : `${season.label} starts in ${season.days_to_start} day${season.days_to_start === 1 ? '' : 's'}`}
            </h2>
          ) : <h2>No peak period coming up</h2>}
          {season.start && season.end && <p className="mg-season-dates">{shortDay(season.start)} – {shortDay(season.end)}</p>}
        </div>
      </div>
      <div className="mg-strip-wrap">
        <div className="mg-strip" data-testid="chart-season-strip">
          {strip.bands.map((b) => {
            const l = pos(b.start); const r = pos(b.end);
            return <div key={b.label + b.start} className="mg-strip-band" style={{ left: `${l}%`, width: `${Math.max(r - l, .6)}%` }}><span>{b.label}</span></div>;
          })}
          {strip.days.map((x) => (
            <div key={x.date} className="mg-strip-day" title={`${shortDay(x.date)}: ${x.confirmed} confirmed, ${x.pending} waiting`}>
              <i className="base" />
              {x.confirmed > 0 && <i className="c" style={{ height: `${(x.confirmed / max) * 62}px` }} />}
              {x.pending > 0 && <i className="p" style={{ height: `${(x.pending / max) * 62}px` }} />}
            </div>
          ))}
          {strip.markers.map((m) => (
            <div key={m.date + m.label} className="mg-strip-marker" style={{ left: `${pos(m.date)}%` }} title={`${m.label}, ${shortDay(m.date)}`}><b /></div>
          ))}
          <div className="mg-strip-today" style={{ left: `${pos(strip.today)}%` }}><span>Today</span></div>
        </div>
        <div className="mg-strip-months">{months.map((m, i) => <span key={i} style={{ flexGrow: m.w }}>{m.w > 10 ? m.label : ''}</span>)}</div>
      </div>
      <div className="mg-strip-legend">
        <span><i className="lg-c" />Confirmed</span>
        <span><i className="lg-p" />Waiting</span>
        <span><i className="lg-b" />Busy period</span>
        <span><i className="lg-f" />Festival</span>
      </div>
      {strip.markers.length > 0 && (
        <div className="mg-festivals">{strip.markers.slice(0, 8).map((m) => <span key={m.date + m.label}>{m.label} · {shortDay(m.date)}</span>)}</div>
      )}
    </section>
  );
}

function RequestCard({ p }: { p: PendingRequest }) {
  const qc = useQueryClient();
  const decide = useDecideEvent();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function approve() {
    setMsg(null);
    try {
      const r = await decide.mutateAsync({ eventId: p.id, data: { action: 'approve' } });
      setMsg({ ok: true, text: r.message });
      setTimeout(() => qc.invalidateQueries({ queryKey: getGetManagerDashboardQueryKey() }), 1800);
    } catch (e) { setMsg({ ok: false, text: errorText(e) }); }
  }
  return (
    <article className="mg-req" data-testid={`card-request-${p.id}`}>
      <div className="mg-req-top">
        <img src={clipart(p.event_type)} alt="" />
        <div style={{ minWidth: 0 }}>
          <h3 data-testid={`text-request-name-${p.id}`}>{p.name}</h3>
          <p className="mg-req-meta">{fmtRange(p)} · {p.area}</p>
          <p className="mg-req-meta">{p.company_name || p.client_name} · {p.guests} guests</p>
        </div>
      </div>
      <div className="eo-inline-actions" style={{ gap: 6 }}>
        {p.repeat_client && <span className="mg-pill"><Repeat size={12} />Repeat customer</span>}
        {p.short > 0 && <span className="mg-pill red"><AlertTriangle size={12} />{p.short} crew short</span>}
      </div>
      <div className="mg-req-nums">
        <div><small>Quote</small><strong data-testid={`text-request-quote-${p.id}`}>{rmRange(p.quote_low, p.quote_high)}</strong></div>
        <div><small>Crew</small><strong><Users size={12} /> {p.crew_total ?? 0}</strong></div>
        <div><small>Margin</small><strong>{Math.round(p.margin_pct)}%</strong></div>
      </div>
      {msg && <div className={`eo-notice ${msg.ok ? 'eo-success' : 'eo-error'}`} style={{ margin: 0 }} data-testid={`text-request-result-${p.id}`}>{msg.text}</div>}
      <div className="mg-req-actions">
        <button className="eo-btn eo-btn-primary" onClick={approve} disabled={decide.isPending || msg?.ok} data-testid={`button-approve-${p.id}`}>
          <Check size={15} />{decide.isPending ? 'Approving…' : 'Approve'}
        </button>
        <Link href={`/manager/events/${p.id}`} className="eo-btn" data-testid={`link-review-${p.id}`}>Review<ArrowRight size={14} /></Link>
      </div>
    </article>
  );
}

const REG_STATUS = { not_booked: ['Not booked yet', 'peach'], requested: ['Requested', 'amber'], booked: ['Booked', ''] } as const;

export default function Dashboard() {
  const q = useGetManagerDashboard();
  const d = q.data;
  return (
    <div className="mg-page">
      <PageHead eyebrow={d ? day(d.today) : 'Today'} title="Dashboard"
        action={<Link href="/manager/new" className="eo-btn eo-btn-primary" data-testid="link-new-event">New event</Link>} />
      {q.isLoading ? <Skeleton rows={6} /> : q.isError || !d ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <SeasonStrip d={d} />
          {!d.model.ready && d.model.message && <div className="eo-notice" style={{ margin: 0 }} data-testid="text-model-notice"><AlertTriangle size={16} />{d.model.message}</div>}
          <div className="mg-kpis">
            <a href="#waiting-for-decision" className="mg-kpi peach" data-testid="kpi-pending" onClick={(event) => {
              const target = document.getElementById('waiting-for-decision');
              if (!target) return;
              event.preventDefault();
              target.focus({ preventScroll: true });
              target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
            }}><label>Waiting for review</label><strong>{d.kpis.pending}</strong></a>
            <Link href="/manager/bookings?period=30" className="mg-kpi mint" data-testid="kpi-confirmed"><label>Confirmed, next 30 days</label><strong>{d.kpis.confirmed_next_30}</strong></Link>
            <div className="mg-kpi amber" data-testid="kpi-revenue"><label>Revenue, next 30 days</label><strong>{rm(d.kpis.revenue_next_30)}</strong></div>
            <div className="mg-kpi sky" data-testid="kpi-open-shifts"><label>Shifts offered to staff</label><strong>{d.kpis.open_shifts}</strong></div>
            <div className="mg-kpi" data-testid="kpi-freelancers"><label>Freelancers needed</label><strong>{d.kpis.freelancers_next_30}</strong></div>
            <div className="mg-kpi" data-testid="kpi-upcoming"><label>All upcoming events</label><strong>{d.kpis.upcoming_total}</strong></div>
          </div>

          <section id="waiting-for-decision" className="mg-decision-section" tabIndex={-1} aria-labelledby="waiting-for-decision-title">
            <div className="mg-section-title"><h2 className="mg-h2" id="waiting-for-decision-title">Waiting for your decision</h2>{d.pending.length > 0 && <span className="mg-count">{d.pending.length}</span>}</div>
            {d.pending.length === 0 ? <div className="mg-card"><Empty title="All caught up" text="New requests from customers will show up here." icon={<Check size={20} />} /></div> : (
              <div className="mg-waiting">{d.pending.map((p) => <RequestCard key={p.id} p={p} />)}</div>
            )}
          </section>

          <div className="mg-grid2">
            <section className="mg-card" data-testid="card-regulars">
              <div className="mg-card-head"><div><h2>Regular customers</h2><p className="mg-muted">Who usually books around now</p></div></div>
              {d.regulars.length === 0 ? <Empty title="No reminders right now" /> : (
                <div className="mg-regs">
                  {d.regulars.map((r) => {
                    const [label, tone] = REG_STATUS[r.status];
                    return (
                      <div className="mg-reg" key={r.client_id} data-testid={`row-regular-${r.client_id}`}>
                        <div><strong>{r.company}</strong><small>{r.contact} · {r.pattern}</small><small>Usually: {r.usual_type}{r.usual_request ? ` · ${r.usual_request}` : ''}</small></div>
                        <div><small>Last: {r.last_event}</small><small>{shortDay(r.last_date)} · {r.last_guests} guests · {rm(r.last_price_rm)}</small></div>
                        <div className="mg-reg-right">
                          <span className={`mg-pill ${tone}`} data-testid={`status-regular-${r.client_id}`}>{label}</span>
                          <small><CalendarClock size={11} /> {shortDay(r.expected_date)} ({r.days_away} days)</small>
                          {r.event_id && <Link href={`/manager/events/${r.event_id}`} className="eo-text-btn" data-testid={`link-regular-event-${r.client_id}`}>Open event</Link>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            <div className="eo-stack">
              <LeaveCard leave={d.leave} />
              <section className="mg-card" data-testid="card-next-events">
                <div className="mg-card-head"><h2>Next confirmed events</h2><Link href="/manager/calendar" className="eo-text-btn" data-testid="link-calendar">Calendar</Link></div>
                {d.next_events.length === 0 ? <Empty title="Nothing confirmed yet" /> : (
                  <ul className="mg-list">
                    {d.next_events.map((e) => (
                      <li key={e.id} style={{ padding: 0 }}>
                        <Link href={`/manager/events/${e.id}`} data-testid={`link-next-${e.id}`} style={{ width: '100%' }}>
                          <div><strong>{e.name}</strong><small>{fmtRange(e)} · {e.area}</small></div>
                          <span className="mg-muted">{rm(e.price_rm)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
