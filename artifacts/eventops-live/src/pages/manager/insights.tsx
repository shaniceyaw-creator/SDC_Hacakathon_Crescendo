import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useGetInsights, type Totals } from '@workspace/api-client-react';
import { rm, shortDay, ROLE_LABEL } from '@/lib/format';
import { PageHead, Skeleton, ErrorState, Empty } from '@/components/manager/common';
import { ROLES } from '@/components/manager/estimate';

const k = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v));

function Change({ a, b }: { a: number; b: number }) {
  if (!b) return null;
  const pct = ((a - b) / Math.abs(b)) * 100;
  return <span className={pct >= 0 ? 'mg-up' : 'mg-down'}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}% vs year before</span>;
}

function Compare({ cur, prev }: { cur: Totals; prev: Totals }) {
  const items: [string, number, number, (n: number) => string][] = [
    ['Revenue', cur.revenue, prev.revenue, rm], ['Cost', cur.cost, prev.cost, rm], ['Profit', cur.profit, prev.profit, rm], ['Events', cur.events, prev.events, String],
  ];
  return (
    <div className="mg-cmp">
      {items.map(([l, a, b, f]) => <div key={l} data-testid={`text-total-${l.toLowerCase()}`}><small>{l}, last 12 months</small><strong>{f(a)}</strong><br /><Change a={a} b={b} /></div>)}
    </div>
  );
}

export default function Insights() {
  const q = useGetInsights();
  const d = q.data;
  return (
    <div className="mg-page">
      <PageHead title="Insights" sub="Money and people, month by month." />
      {q.isLoading ? <Skeleton rows={4} /> : q.isError || !d ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (
        <>
          <section className="mg-band fin" data-testid="section-financial">
            <h2>Financial</h2>
            <div className="mg-band-grid">
              <Compare cur={d.last_12} prev={d.previous_12} />
              <div className="mg-card">
                <div className="mg-card-head"><h2>Monthly revenue, cost and profit</h2><span className="mg-muted">Faded bars are planned months</span></div>
                <div className="mg-chart" data-testid="chart-monthly-money">
                  <ResponsiveContainer>
                    <BarChart data={d.monthly} margin={{ left: -10, right: 4 }}>
                      <CartesianGrid vertical={false} stroke="#e4e9df" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                      <YAxis tickFormatter={k} tickLine={false} axisLine={false} fontSize={11} />
                      <Tooltip formatter={(v: number) => rm(v)} />
                      <Legend />
                      {([['revenue', 'Revenue', '#287464'], ['cost', 'Cost', '#e98a6a'], ['profit', 'Profit', '#e3b04b']] as const).map(([key, name, color]) => (
                        <Bar key={key} dataKey={key} name={name} fill={color} radius={[4, 4, 0, 0]}>
                          {d.monthly.map((m) => <Cell key={m.month} fill={color} fillOpacity={m.planned ? 0.35 : 1} />)}
                        </Bar>
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="mg-grid2">
                <div className="mg-card">
                  <h2 style={{ marginBottom: 8 }}>By event type</h2>
                  <div className="mg-table-wrap">
                    <table className="mg-table" data-testid="table-by-type">
                      <thead><tr><th>Type</th><th className="n">Events</th><th className="n">Revenue</th><th className="n">Avg price</th><th className="n">Margin</th></tr></thead>
                      <tbody>{d.by_type.map((t) => <tr key={t.type}><td>{t.type}</td><td className="n">{t.events}</td><td className="n">{rm(t.revenue)}</td><td className="n">{rm(t.avg_price)}</td><td className="n">{t.margin_pct.toFixed(1)}%</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
                <div className="mg-card">
                  <h2 style={{ marginBottom: 8 }}>Top customers</h2>
                  {d.top_customers.length === 0 ? <Empty title="No customers yet" /> : (
                    <ul className="mg-list" data-testid="list-top-customers">{d.top_customers.map((c, i) => <li key={c.name}><span><b style={{ color: 'var(--eo-teal)', marginRight: 8 }}>{i + 1}</b>{c.name}</span><strong>{rm(c.revenue)}</strong></li>)}</ul>
                  )}
                </div>
              </div>
              <div className="mg-card">
                <h2 style={{ marginBottom: 8 }}>Recent events</h2>
                {d.recent.length === 0 ? <Empty title="No recent events" /> : (
                  <div className="mg-table-wrap">
                    <table className="mg-table" data-testid="table-recent">
                      <thead><tr><th>Date</th><th>Event</th><th>Area</th><th className="n">Guests</th><th className="n">Crew</th><th className="n">Price</th><th className="n">Cost</th></tr></thead>
                      <tbody>{d.recent.map((r, i) => <tr key={i}><td>{shortDay(r.date)}</td><td>{r.name}<br /><small className="mg-muted">{r.type}</small></td><td>{r.area}</td><td className="n">{r.guests}</td><td className="n">{r.crew}</td><td className="n">{rm(r.price)}</td><td className="n">{rm(r.cost)}</td></tr>)}</tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="mg-band lab" data-testid="section-labour">
            <h2>Labour</h2>
            <div className="mg-band-grid">
              <div className="mg-cmp">
                <div><small>Crew hours, last 12 months</small><strong>{Math.round(d.last_12.crew_hours).toLocaleString('en-MY')}</strong><br /><Change a={d.last_12.crew_hours} b={d.previous_12.crew_hours} /></div>
                <div><small>Average crew per event</small><strong>{d.last_12.avg_crew.toFixed(1)}</strong></div>
                <div data-testid="text-open-shifts"><small>Open shifts</small><strong>{d.open_shifts}</strong></div>
                <div data-testid="text-open-shift-pay"><small>Extra pay on offer</small><strong>{rm(d.open_shift_pay)}</strong></div>
              </div>
              <div className="mg-card">
                <h2>Crew hours per month</h2>
                <div className="mg-chart" data-testid="chart-crew-hours">
                  <ResponsiveContainer>
                    <BarChart data={d.monthly} margin={{ left: -10, right: 4 }}>
                      <CartesianGrid vertical={false} stroke="#e4e9df" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                      <YAxis tickLine={false} axisLine={false} fontSize={11} />
                      <Tooltip formatter={(v: number) => `${Math.round(v)} hours`} />
                      <Bar dataKey="crew_hours" name="Crew hours" radius={[4, 4, 0, 0]}>
                        {d.monthly.map((m) => <Cell key={m.month} fill="#287464" fillOpacity={m.planned ? 0.35 : 1} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="mg-grid2">
                <div className="mg-card">
                  <h2 style={{ marginBottom: 12 }}>Booked hours, next 30 days</h2>
                  <div className="mg-hours" data-testid="list-people-hours">
                    {d.people.map((p) => {
                      const pct = p.capacity_next_30 ? Math.min(1, p.hours_next_30 / p.capacity_next_30) : 0;
                      return (
                        <div className="mg-hours-row" key={p.id}>
                          <span>{p.name}<br /><small className="mg-muted">{ROLE_LABEL[p.role] ?? p.role}</small></span>
                          <div className="mg-bar"><i className={pct >= 0.9 ? 'over' : ''} style={{ transform: `scaleX(${pct})` }} /></div>
                          <span>{Math.round(p.hours_next_30)} / {Math.round(p.capacity_next_30)} h</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="mg-card">
                  <h2 style={{ marginBottom: 8 }}>Average crew by event type</h2>
                  <div className="mg-table-wrap">
                    <table className="mg-table" data-testid="table-crew-by-type">
                      <thead><tr><th>Type</th>{ROLES.map((r) => <th key={r} className="n">{ROLE_LABEL[r]}</th>)}</tr></thead>
                      <tbody>{d.by_type.map((t) => <tr key={t.type}><td>{t.type}</td>{ROLES.map((r) => <td key={r} className="n">{t.roles[r].toFixed(1)}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
