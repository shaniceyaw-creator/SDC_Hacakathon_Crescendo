import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Check, Loader2, Send } from 'lucide-react';
import { getGetCustomerHomeQueryKey, useCreateEvent, useGetCustomerHome, type CreatedEvent } from '@workspace/api-client-react';
import { rmRange } from '@/lib/format';
import { applyType, changeStartDate, checkBooking, defaultsFor, fmtRange, toInput, type BookingForm } from '@/lib/booking';
import { BookingFields } from '@/components/booking/booking-fields';
import { ErrorState, PageHead, Skel, errMsg } from '@/components/people/bits';
import '@/styles/people.css';

export default function CustomerOrganise() {
  const home = useGetCustomerHome();
  const create = useCreateEvent();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [f, setF] = useState<BookingForm | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<CreatedEvent | null>(null);
  const opts = home.data?.options;
  const inited = useRef(false);
  useEffect(() => { if (opts && !inited.current) { inited.current = true; setF(defaultsFor(opts, 'customer')); } }, [opts]);
  const set = <K extends keyof BookingForm>(k: K, v: BookingForm[K]) => setF((p) => (p ? { ...p, [k]: v } : p));
  const onStart = (date: string) => setF((p) => (p && opts ? changeStartDate(p, date, opts) : p));
  const onType = (n: string) => { if (opts) setF((p) => (p ? applyType(opts, p, n, 'customer') : p)); };
  const check = f && opts ? checkBooking(f, opts, 'customer') : null;

  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null);
    if (!f || !opts || !check) return;
    if (check.contact) return;
    if (check.errors.length) { setErr(check.errors[0]); return; }
    try {
      const r = await create.mutateAsync({ data: { event: { name: name.trim(), ...toInput(f) } } });
      setDone(r);
      await qc.invalidateQueries({ queryKey: getGetCustomerHomeQueryKey() });
    } catch (er) { setErr(errMsg(er)); }
  }

  if (done) return (
    <div className="pp-page">
      <div className="pp-done pp-rise" data-testid="card-request-sent">
        <span className="pp-done-ico"><Check size={28} /></span>
        <h2>Request sent</h2>
        <p style={{ color: 'var(--eo-muted)' }}>{done.event.name} · {fmtRange(done.event)}</p>
        <p className="eo-small" data-testid="text-preapproval-place">{done.event.venue_name ? `${done.event.venue_name} · ` : ''}{done.event.area} · about {Math.round(opts?.areas.find((a) => a.name === done.event.area)?.km ?? 0)} km from our base</p>
        <div className="pp-quote" data-testid="text-quote-range">{rmRange(done.quote_low, done.quote_high)}</div>
        <p className="eo-small">Estimated price range</p>
        <p style={{ marginTop: 14, fontWeight: 600 }} data-testid="text-wait">Please wait for our reply. We will confirm the final price.</p>
        <div className="pp-done-actions">
          <Link href="/customer" className="eo-btn eo-btn-primary pp-big" data-testid="link-my-requests">See my requests</Link>
          <button className="eo-btn pp-big" onClick={() => { setDone(null); setName(''); if (opts) setF(defaultsFor(opts, 'customer')); }} data-testid="button-new-request">Send another</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="pp-page">
      <PageHead kicker="Organise" title="Organise an event" sub="Fill this in and we'll send a price range." />
      {home.isLoading ? <Skel rows={4} tall /> : home.isError || !opts || !f ? <ErrorState error={home.error} onRetry={() => home.refetch()} /> : (
        <form className="pp-form pp-rise-2" onSubmit={submit}>
          <div className="pp-card eo-stack">
            <label className="eo-field">Event name<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Aunty Mei's 60th" data-testid="input-name" /></label>
            <BookingFields o={opts} f={f} role="customer" set={set} onType={onType} onStart={onStart} />
          </div>
          <div className="pp-card eo-stack">
            <div>
              <h2 className="pp-h2" style={{ marginBottom: 8 }}>Where?</h2>
              <div className="pp-map" data-testid="map-areas">
                <MapContainer center={[opts.base.lat, opts.base.lon]} zoom={10} scrollWheelZoom={false}>
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
                  {opts.areas.map((a) => {
                    const on = a.name === f.area;
                    return (
                      <CircleMarker key={a.name} center={[a.lat, a.lon]} radius={on ? 12 : 8}
                        pathOptions={{ color: on ? '#c4623c' : '#1b5d4f', fillColor: on ? '#e98a6a' : '#287464', fillOpacity: on ? .9 : .6, weight: 2 }}
                        eventHandlers={{ click: () => set('area', a.name) }}>
                        <Tooltip>{a.name}</Tooltip>
                      </CircleMarker>
                    );
                  })}
                </MapContainer>
              </div>
              <p className="pp-picked" data-testid="text-picked-area">{f.area ? <>Area: <b>{f.area}</b></> : 'Tap a dot on the map, or use the Area list.'}</p>
            </div>
            {err && <div className="eo-notice eo-error" role="alert" style={{ margin: 0 }} data-testid="text-submit-error">{err}</div>}
            <button type="submit" className="eo-btn eo-btn-primary pp-big" disabled={create.isPending || !!check?.contact} data-testid="button-submit-request">
              {create.isPending ? <><Loader2 size={16} className="animate-spin" />Sending…</> : <><Send size={16} />Send request</>}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
