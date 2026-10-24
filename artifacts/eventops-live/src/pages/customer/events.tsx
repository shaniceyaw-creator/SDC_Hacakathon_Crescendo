import { MapPin, Ticket } from 'lucide-react';
import { useGetPublicEvents } from '@workspace/api-client-react';
import { clipart } from '@/lib/format';
import { fmtDates, fmtTimes } from '@/lib/booking';
import { Empty, ErrorState, PageHead, Skel } from '@/components/people/bits';
import '@/styles/people.css';

export default function CustomerEvents() {
  const q = useGetPublicEvents();
  const areas = (q.data?.areas ?? []).filter((a) => a.events.length > 0);
  return (
    <div className="pp-page">
      <PageHead kicker="Join" title="Events near you" sub="Public events across KL & Selangor." />
      {q.isLoading ? <Skel rows={3} tall /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> :
        areas.length === 0 ? <Empty icon={<Ticket size={22} />} title="No public events yet" text="Check back soon." /> : (
        <div className="eo-stack pp-rise-2" style={{ gap: 32 }}>
          {areas.map((a) => (
            <section className="pp-area" key={a.area} data-testid={`section-area-${a.area}`}>
              <h2><MapPin size={16} style={{ display: 'inline', marginRight: 6, color: '#c4623c' }} />{a.area}<small>{a.state} · {a.events.length}</small></h2>
              <div className="pp-evgrid">
                {a.events.map((e) => (
                  <article className="pp-ev" key={e.id} data-testid={`card-event-${e.id}`}>
                    <img src={clipart(e.event_type)} alt={e.event_type} loading="lazy" />
                    <div className="pp-ev-body">
                      <span className="pp-chip" style={{ alignSelf: 'flex-start' }}>{e.event_type}</span>
                      <h3 data-testid={`text-event-name-${e.id}`}>{e.name}</h3>
                      <div className="pp-meta" style={{ marginTop: 0 }}><span>{fmtDates(e)}</span><span>{fmtTimes(e)}</span><span>{e.venue_type}</span></div>
                      <p className="pp-ev-org">By {e.organiser}</p>
                      <button className="eo-btn" disabled title="Tickets not on sale yet" data-testid={`button-buy-${e.id}`}><Ticket size={15} />Buy ticket · soon</button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
