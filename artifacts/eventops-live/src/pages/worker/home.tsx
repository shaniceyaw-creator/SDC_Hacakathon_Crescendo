import { Link } from 'wouter';
import { CalendarDays, Clock, CloudRain, Droplets, HandCoins, MapPin, Phone, Sun, Thermometer, Users, Wind, Coffee, Plane, Briefcase } from 'lucide-react';
import { useGetWorkerHome, useGetWorkerTips, type WorkerJob, type WorkerTips } from '@workspace/api-client-react';
import { daysFrom, rm, shortDay, ROLE_LABEL } from '@/lib/format';
import { fmtTimes, fmtWorkerShift } from '@/lib/booking';
import { Empty, ErrorState, PageHead, Skel } from '@/components/people/bits';
import '@/styles/people.css';

const TIP_ICON = { haze: Wind, rain: CloudRain, heat: Thermometer, sun: Sun, rest: Coffee, water: Droplets };

function when(today: string, date: string) {
  const d = daysFrom(today, date);
  return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`;
}

function JobCard({ job, today, first }: { job: WorkerJob; today: string; first: boolean }) {
  const dt = new Date(job.date + 'T00:00:00');
  return (
    <article className={'pp-job' + (first ? ' first' : '')} data-testid={`card-job-${job.id}`}>
      <div className="pp-job-date">
        <span>{dt.toLocaleDateString('en-MY', { month: 'short' })}</span>
        <b>{dt.getDate()}</b>
        <span>{dt.toLocaleDateString('en-MY', { weekday: 'short' })}</span>
        <em>{when(today, job.date)}</em>
        {job.end_date && job.end_date.slice(0, 10) !== job.date.slice(0, 10) && <small>to {shortDay(job.end_date)}</small>}
      </div>
      <div className="pp-job-body">
        <h3 data-testid={`text-job-name-${job.id}`}>{job.name}</h3>
        <div className="pp-meta">
          <span className="pp-report" data-testid={`text-report-${job.id}`}><Clock size={13} />Shift {fmtWorkerShift(job)}</span>
          <span>{fmtTimes(job)}</span>
          <span><MapPin size={14} />{job.area}</span>
        </div>
        <div className="pp-chips">
          <span className="pp-chip">{ROLE_LABEL[job.my_role] ?? job.my_role}</span>
          <span className="pp-chip" style={{ background: '#f0f1e9', color: '#59624f' }}>{job.setting}</span>
          {job.extra && <span className="pp-chip extra" data-testid={`text-extra-${job.id}`}>Extra shift{job.extra_pay_rm != null ? ` · ${rm(job.extra_pay_rm)}` : ''}</span>}
        </div>
        {job.teammates.length > 0 && (
          <details className="pp-team">
            <summary data-testid={`button-team-${job.id}`}><Users size={13} style={{ display: 'inline', marginRight: 6 }} />Team ({job.teammates.length})</summary>
            <ul>
              {job.teammates.map((t, i) => (
                <li key={i}><span>{t.name} <span style={{ color: 'var(--eo-muted)' }}>· {ROLE_LABEL[t.role] ?? t.role}</span></span>
                  <a href={`tel:${t.phone}`} data-testid={`link-phone-${job.id}-${i}`}><Phone size={12} style={{ display: 'inline' }} /> {t.phone}</a></li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </article>
  );
}

function Weather({ tips }: { tips: WorkerTips }) {
  const f = tips.forecast;
  return (
    <section className="pp-weather" data-testid="card-weather">
      <div className="pp-weather-top">
        <div>
          <p className="pp-kicker">Look after yourself</p>
          <h2 className="pp-h2" style={{ marginTop: 4 }}>{tips.place}, {shortDay(tips.date)}</h2>
        </div>
        {f && <span className="pp-temp" data-testid="text-temp">{Math.round(f.temp_max)}°</span>}
      </div>
      {tips.error || !f ? (
        <p className="pp-reason" data-testid="text-weather-error">{tips.error ?? 'Weather is not available right now.'}</p>
      ) : (
        <>
          <p style={{ fontSize: 13 }} data-testid="text-forecast-summary">{f.summary}</p>
          <div className="pp-wstats">
            <div><label>Rain</label><b data-testid="text-rain">{Math.round(f.rain_chance)}%</b></div>
            <div><label>UV</label><b data-testid="text-uv">{Math.round(f.uv_max)}</b></div>
            <div><label>Air</label><b data-testid="text-aqi">{f.aqi ?? '–'}</b></div>
          </div>
        </>
      )}
      <div className="pp-tips">
        {tips.tips.map((t, i) => {
          const Icon = TIP_ICON[t.kind] ?? Sun;
          return <div className="pp-tip" key={i} data-testid={`card-tip-${t.kind}`}><Icon size={17} /><div><strong>{t.title}</strong><p>{t.text}</p></div></div>;
        })}
      </div>
      <p className="pp-source">Weather: {tips.source || 'Open-Meteo'}</p>
    </section>
  );
}

export default function WorkerHome() {
  const home = useGetWorkerHome();
  const tips = useGetWorkerTips();
  const d = home.data;

  return (
    <div className="pp-page">
      <PageHead kicker="My jobs" title={d ? `Hi, ${d.me.name.split(' ')[0]}` : 'My jobs'} sub="Your next jobs, hours and team."
        action={<Link href="/worker/shifts" className="eo-btn eo-btn-primary pp-big" data-testid="link-open-shifts"><HandCoins size={17} />Open shifts{d && d.open_tasks.length ? ` (${d.open_tasks.length})` : ''}</Link>} />
      {home.isLoading ? <Skel rows={4} tall /> : home.isError || !d ? <ErrorState error={home.error} onRetry={() => home.refetch()} /> : (
        <>
          <div className="pp-hours pp-rise-2">
            <div className="pp-hour"><label>This week</label>
              <strong data-testid="text-hours-week">{d.me.hours_this_week}<small> / {d.me.weekly_cap} h</small></strong>
              <div className="pp-bar"><i className={d.me.hours_this_week > d.me.weekly_cap ? 'over' : ''} style={{ width: `${Math.min(100, (d.me.hours_this_week / Math.max(1, d.me.weekly_cap)) * 100)}%` }} /></div>
            </div>
            <div className="pp-hour"><label>This month</label><strong data-testid="text-hours-month">{d.me.hours_this_month}<small> h</small></strong></div>
            <div className="pp-hour"><label>Extra earned</label><strong data-testid="text-extra-earned">{rm(d.extra_earned_rm)}</strong></div>
          </div>
          <div className="pp-wgrid">
            <section className="pp-rise-3">
              <h2 className="pp-h2"><Briefcase size={17} />Next jobs <small>{d.jobs.length}</small></h2>
              {d.jobs.length === 0 ? (
                <Empty icon={<CalendarDays size={22} />} title="No jobs yet" text="New jobs show up here once approved.">
                  <Link href="/worker/shifts" className="eo-btn eo-btn-primary" data-testid="link-empty-shifts">See open shifts</Link>
                </Empty>
              ) : <div className="pp-jobs">{d.jobs.map((j, i) => <JobCard key={j.id} job={j} today={d.today} first={i === 0} />)}</div>}
            </section>
            <aside className="eo-stack pp-rise-3">
              {tips.isLoading ? <Skel rows={1} tall /> : tips.isError || !tips.data ? <ErrorState error={tips.error} onRetry={() => tips.refetch()} /> : <Weather tips={tips.data} />}
              <section className="pp-card pp-leave" data-testid="card-leave">
                <h2 className="pp-h2"><Plane size={16} />My leave</h2>
                {d.leave.length === 0 ? <p className="eo-small">No leave booked.</p> : (
                  <ul>{d.leave.map((l) => (
                    <li key={l.id} data-testid={`row-leave-${l.id}`}><span>{shortDay(l.start)}{l.end !== l.start ? ` – ${shortDay(l.end)}` : ''}</span><span className="pp-status" data-s={l.status === 'Approved' ? 'Approved' : ''}>{l.status}</span></li>
                  ))}</ul>
                )}
                <p className="eo-small" style={{ marginTop: 10 }}>Apply for leave in Orbyte.</p>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
