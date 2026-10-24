import { useGetTeam } from '@workspace/api-client-react';
import { shortDay } from '@/lib/format';
import { PageHead, Skeleton, ErrorState, Empty, LeaveCard } from '@/components/manager/common';

export default function TeamPage() {
  const q = useGetTeam();
  const d = q.data;
  return (
    <div className="mg-page">
      <PageHead title="Team & data" sub="Who is free, who is busy, and where the data comes from." />
      {q.isLoading ? <Skeleton rows={5} /> : q.isError || !d ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <section className="mg-card" data-testid="card-availability">
            <div className="mg-card-head">
              <h2>Availability</h2>
              <div className="mg-legend">
                <span><i style={{ background: '#eef1e8', border: '1px solid var(--eo-line)' }} />Free</span>
                <span><i style={{ background: 'var(--eo-teal)' }} />Event</span>
                <span><i style={{ background: '#e98a6a' }} />Leave</span>
                <span><i style={{ background: '#f6c66f' }} />Leave pending</span>
              </div>
            </div>
            {d.staff.length === 0 ? <Empty title="No staff yet" /> : (
              <div className="mg-avail-wrap">
                <table className="mg-avail" data-testid="table-availability">
                  <thead><tr><th className="name">Staff</th>{d.days.map((x) => (
                    <th key={x}>{new Date(`${x}T00:00:00`).toLocaleDateString('en-MY', { weekday: 'narrow' })}<br />{Number(x.slice(8, 10))}</th>
                  ))}</tr></thead>
                  <tbody>{d.staff.map((s) => (
                    <tr key={s.id} data-testid={`row-staff-${s.id}`}>
                      <td className="name"><strong>{s.name}</strong><small>{s.role_label} · {s.upcoming_jobs} jobs</small></td>
                      {s.days.map((x) => <td key={x.date} className={`d ${x.state}`} title={`${shortDay(x.date)}: ${x.label}`} />)}
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>

          <div className="mg-grid2">
            <section className="mg-card" data-testid="card-weekly-hours">
              <h2 style={{ marginBottom: 12 }}>Hours this week</h2>
              <div className="mg-hours">
                {d.staff.map((s) => {
                  const pct = s.weekly_cap ? Math.min(1, s.hours_this_week / s.weekly_cap) : 0;
                  return (
                    <div className="mg-hours-row" key={s.id} data-testid={`row-hours-${s.id}`}>
                      <span>{s.name}</span>
                      <div className="mg-bar"><i className={pct >= 0.9 ? 'over' : ''} style={{ transform: `scaleX(${pct})` }} /></div>
                      <span>{Math.round(s.hours_this_week)} / {s.weekly_cap} h</span>
                    </div>
                  );
                })}
              </div>
            </section>
            <div className="eo-stack">
              <LeaveCard leave={d.leave} />
              <section className="mg-card" data-testid="card-model-status">
                <h2 style={{ marginBottom: 12 }}>Estimate model</h2>
                <div className="mg-model">
                  <span className={`mg-model-dot${d.model.ready ? '' : ' off'}`} />
                  <div>
                    <strong data-testid="text-model-status">{d.model.ready ? (d.model.source === 'runpod' ? 'Trained model' : 'Development model') : 'Not ready'}</strong>
                    <p className="mg-muted">
                      {d.model.ready
                        ? d.model.price_error_pct != null ? `Price usually within ${Math.round(d.model.price_error_pct)}%` : 'Working normally'
                        : d.model.message ?? 'Estimates are unavailable right now.'}
                    </p>
                  </div>
                </div>
              </section>
              <section className="mg-card" data-testid="card-sources">
                <h2 style={{ marginBottom: 6 }}>Data sources</h2>
                <ul className="mg-list">
                  {d.sources.map((s) => <li key={s.name}><div><strong>{s.name}</strong><small>{s.detail}</small></div><span className="mg-pill grey">{s.count.toLocaleString('en-MY')}</span></li>)}
                </ul>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
