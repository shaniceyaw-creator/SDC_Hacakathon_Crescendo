import { useMemo } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { ChevronRight, ClipboardList } from 'lucide-react';
import { useListBookings, getListBookingsQueryKey } from '@workspace/api-client-react';
import { PageHead, Skeleton, ErrorState, Empty } from '@/components/manager/common';
import { TypeBadge } from '@/components/bookings/type-badge';
import { clipart } from '@/lib/format';
import { addDays, fmtRange, todayMYT } from '@/lib/booking';
import { filterBookings, groupBookings, readState, sortBookings, toSearch, toneFor, typesIn, type GroupBy, type ListState } from '@/lib/booking-list';
import '@/styles/manager.css';
import '@/styles/bookings.css';
import '@/styles/booking-list.css';

export default function BookingsList({ base }: { base: 'manager' | 'worker' }) {
  const q = useListBookings({ query: { queryKey: getListBookingsQueryKey(), refetchInterval: 30000 } });
  const search = useSearch();
  const [loc, navigate] = useLocation();
  const st = useMemo(() => readState(search), [search]);
  const set = (patch: Partial<ListState>) => navigate(`${loc}${toSearch({ ...st, ...patch })}`);
  const href = (patch: Partial<ListState>) => `/${base}/bookings${toSearch({ ...st, ...patch })}`;
  const types = useMemo(() => typesIn(q.data ?? []), [q.data]);
  const groups = useMemo(() => {
    const t = todayMYT();
    return groupBookings(sortBookings(filterBookings(q.data ?? [], st, t, addDays(t, 30)), st.sort), st.group);
  }, [q.data, st]);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="mg-page">
      <PageHead eyebrow={base === 'manager' ? 'Progress' : 'Shared with the team'} title={base === 'manager' ? 'Confirmed bookings' : 'Team bookings'} sub="Tasks, budget and demo receipts for every approved event." />
      <div className="bl-ctrls" role="group" aria-label="Organise bookings">
        <div className="bl-lab">Period
          <div className="bl-seg">
            <Link href={href({ period: 'all' })} className={`eo-btn${st.period === 'all' ? ' on' : ''}`} aria-current={st.period === 'all' ? 'true' : undefined} data-testid="filter-all">All confirmed</Link>
            <Link href={href({ period: '30' })} className={`eo-btn${st.period === '30' ? ' on' : ''}`} aria-current={st.period === '30' ? 'true' : undefined} data-testid="filter-30">Next 30 days</Link>
          </div>
        </div>
        <label>Event type
          <select value={st.type} onChange={(e) => set({ type: e.target.value })} data-testid="select-type">
            <option value="all">All types</option>
            {st.type !== 'all' && !types.includes(st.type) && <option value={st.type}>{st.type}</option>}
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>Order
          <select value={st.sort} onChange={(e) => set({ sort: e.target.value === 'desc' ? 'desc' : 'asc' })} data-testid="select-sort">
            <option value="asc">Soonest first</option>
            <option value="desc">Latest first</option>
          </select>
        </label>
        <label>Group by
          <select value={st.group} onChange={(e) => set({ group: e.target.value as GroupBy })} data-testid="select-group">
            <option value="date">Date</option>
            <option value="type">Event type</option>
            <option value="none">No grouping</option>
          </select>
        </label>
        {!q.isLoading && !q.isError && <span className="bl-count" aria-live="polite" data-testid="text-count">{total} {total === 1 ? 'booking' : 'bookings'}</span>}
      </div>
      {q.isLoading ? <Skeleton rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : total === 0 ? (
        <div className="mg-card">
          <Empty title="No confirmed bookings here" text={st.period === '30' ? 'Nothing matches in the next 30 days.' : st.type !== 'all' ? 'No confirmed bookings of this type.' : 'Approved events will appear here.'} icon={<ClipboardList size={20} />} />
          {(st.type !== 'all' || st.period !== 'all') && <p style={{ textAlign: 'center', margin: '0 0 14px' }}><Link href={href({ type: 'all', period: 'all' })} className="bl-clear" data-testid="link-clear-filters">Clear filters</Link></p>}
        </div>
      ) : (
        groups.map((g) => (
          <section className="bl-group" key={g.key} aria-label={g.label || 'Bookings'}>
            {g.label && <h2>{g.label}<small>{g.items.length}</small></h2>}
            <ul className="bl-grid" role="list">
              {g.items.map((e) => {
                const d = new Date(`${e.date.slice(0, 10)}T00:00:00Z`);
                return (
                <li key={e.id}>
                <Link href={`/${base}/bookings/${e.id}`} className="bl-card" style={{ ['--bar' as string]: toneFor(e.event_type).bar }} data-testid={`link-booking-${e.id}`}>
                    <span className="bl-date" aria-hidden="true"><b>{d.toLocaleDateString('en-MY', { day: 'numeric', timeZone: 'UTC' })}</b>{d.toLocaleDateString('en-MY', { month: 'short', timeZone: 'UTC' })}</span>
                    <img className="bl-thumb" src={clipart(e.event_type)} alt="" loading="lazy" />
                    <span className="bl-main">
                      <span className="bl-top"><h3>{e.name}</h3><TypeBadge type={e.event_type} /></span>
                      <p>{fmtRange(e)}</p>
                      <p>{e.venue_name ? `${e.venue_name}, ` : ''}{e.area}</p>
                    </span>
                    <span className="bl-guests"><b>{e.guests}</b>guests</span>
                    <ChevronRight className="bl-go" size={18} aria-hidden="true" />
                  </Link>
                </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
