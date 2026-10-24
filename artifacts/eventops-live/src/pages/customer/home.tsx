import { Link } from 'wouter';
import { ArrowUpRight, Inbox, PartyPopper, Ticket } from 'lucide-react';
import { useGetCustomerHome } from '@workspace/api-client-react';
import { day, rmRange } from '@/lib/format';
import { fmtRange } from '@/lib/booking';
import { Empty, ErrorState, PageHead, Skel } from '@/components/people/bits';
import '@/styles/people.css';

export default function CustomerHome() {
  const home = useGetCustomerHome();
  const d = home.data;
  return (
    <div className="pp-page">
      <PageHead kicker="Welcome" title={d ? `Hello, ${d.me.name.split(' ')[0]}` : 'Hello'} sub="What would you like to do?" />
      <div className="pp-choose pp-rise-2">
        <Link href="/customer/organise" className="pp-choice org" data-testid="link-organise">
          <span className="pp-choice-ico"><PartyPopper size={26} /></span><span className="pp-choice-go"><ArrowUpRight size={20} /></span>
          <h2>Organise an event</h2><p>Tell us what you need. Get a price range.</p>
        </Link>
        <Link href="/customer/events" className="pp-choice join" data-testid="link-join">
          <span className="pp-choice-ico"><Ticket size={26} /></span><span className="pp-choice-go"><ArrowUpRight size={20} /></span>
          <h2>Join an event</h2><p>Public events near you.</p>
        </Link>
      </div>
      {home.isLoading ? <Skel rows={3} /> : home.isError || !d ? <ErrorState error={home.error} onRetry={() => home.refetch()} /> : (
        <>
          <section className="pp-rise-3">
            <h2 className="pp-h2">My requests <small>{d.requests.length}</small></h2>
            {d.requests.length === 0 ? <Empty icon={<Inbox size={22} />} title="No requests yet" text="Your event requests will show here." /> : (
              <div className="pp-req">
                {d.requests.map((r) => (
                  <article className="pp-reqcard" key={r.id} data-testid={`card-request-${r.id}`}>
                    <div style={{ minWidth: 0 }}>
                      <h3 style={{ fontSize: 16 }}>{r.name}</h3>
                      <div className="pp-meta" style={{ marginTop: 4 }}><span>{r.event_type}</span><span>{fmtRange(r)}</span><span>{r.guests} guests · {r.area}</span></div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className="pp-status" data-s={r.status} data-testid={`status-request-${r.id}`}>{r.status_label}</span>
                      <div className="pp-quote" style={{ marginTop: 8 }} data-testid={`text-quote-${r.id}`}>{r.price_rm != null && r.status === 'Approved' ? `RM ${r.price_rm.toLocaleString('en-MY')}` : rmRange(r.quote_low, r.quote_high)}</div>
                    </div>
                    {r.decision_note && <p className="pp-note" data-testid={`text-note-${r.id}`}>{r.decision_note}</p>}
                  </article>
                ))}
              </div>
            )}
          </section>
          {d.past_events.length > 0 && (
            <section>
              <h2 className="pp-h2">Past events with us <small>{d.past_events.length}</small></h2>
              <ul className="pp-past">{d.past_events.map((p, i) => <li key={i} data-testid={`row-past-${i}`}><strong>{p.name}</strong><span style={{ color: 'var(--eo-muted)' }}>{p.type} · {day(p.date)}</span></li>)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
