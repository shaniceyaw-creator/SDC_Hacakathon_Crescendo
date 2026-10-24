import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, X, Ban, RotateCcw, Save } from 'lucide-react';
import {
  useGetEvent, useUpdateEvent, useDecideEvent, getGetEventQueryKey, getGetManagerDashboardQueryKey,
  type CrewCounts, type EventDetail,
} from '@workspace/api-client-react';
import { rm, shortDay, clipart, ROLE_LABEL } from '@/lib/format';
import { fmtRange } from '@/lib/booking';
import { StaffingEditor } from '@/components/manager/staffing-editor';
import { Skeleton, ErrorState, Empty, errorText, errorStatus } from '@/components/manager/common';
import { MoneyRow, Warnings, EquipmentTable, StaffingList, ROLES } from '@/components/manager/estimate';

const STATUS_TONE: Record<string, string> = { Pending: 'amber', Approved: '', Declined: 'red', Cancelled: 'grey', Completed: 'grey' };

function Editors({ d, onMsg }: { d: EventDetail; onMsg: (m: { ok: boolean; text: string }) => void }) {
  const qc = useQueryClient();
  const update = useUpdateEvent();
  const [crew, setCrew] = useState<CrewCounts>(d.crew);
  const [price, setPrice] = useState(String(Math.round(d.price_rm)));
  const editable = d.summary.status === 'Pending';

  async function send(data: { crew?: CrewCounts | null; price_rm?: number | null }, ok: string) {
    try {
      await update.mutateAsync({ eventId: d.summary.id, data: { expected_version: d.version, ...data } });
      onMsg({ ok: true, text: ok });
    } catch (e) {
      onMsg({ ok: false, text: errorText(e) });
      if (errorStatus(e) !== 409) return;
    }
    await qc.invalidateQueries({ queryKey: getGetEventQueryKey(d.summary.id) });
    qc.invalidateQueries({ queryKey: getGetManagerDashboardQueryKey() });
  }

  return (
    <>
      <section className="mg-card" data-testid="card-crew">
        <div className="mg-card-head">
          <div><h2>Crew per role</h2>{d.crew_changed && <span className="mg-pill amber" style={{ marginTop: 6 }}>Changed by you</span>}</div>
          {editable && (
            <div className="eo-inline-actions">
              {d.crew_changed && <button className="eo-btn" onClick={() => send({ crew: null }, 'Back to the model numbers.')} disabled={update.isPending} data-testid="button-crew-reset"><RotateCcw size={14} />Use model numbers</button>}
              <button className="eo-btn eo-btn-primary" onClick={() => send({ crew }, 'Crew saved.')} disabled={update.isPending} data-testid="button-crew-save"><Save size={14} />Save crew</button>
            </div>
          )}
        </div>
        <div className="mg-crew">
          {ROLES.map((r) => (
            <div key={r}>
              <small>{ROLE_LABEL[r]}</small>
              {editable ? (
                <input type="number" min={0} value={crew[r]} onChange={(e) => setCrew({ ...crew, [r]: Math.max(0, Number(e.target.value)) })} data-testid={`input-crew-${r}`} />
              ) : <strong data-testid={`text-crew-${r}`}>{d.crew[r]}</strong>}
              <small>Model: {d.estimate.crew[r]}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="mg-card" data-testid="card-price">
        <div className="mg-card-head">
          <div><h2>Price</h2>{d.price_changed && <span className="mg-pill amber" style={{ marginTop: 6 }}>Changed by you</span>}</div>
        </div>
        <MoneyRow est={d.estimate} price={d.price_rm} />
        {editable && (
          <div className="eo-toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
            <label className="eo-field">Price (RM)<input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} data-testid="input-price" /></label>
            <button className="eo-btn eo-btn-primary" onClick={() => send({ price_rm: Number(price) }, 'Price saved.')} disabled={update.isPending || !price} data-testid="button-price-save"><Save size={14} />Save price</button>
            {d.price_changed && <button className="eo-btn" onClick={() => send({ price_rm: null }, 'Back to the model price.')} disabled={update.isPending} data-testid="button-price-reset"><RotateCcw size={14} />Use model price ({rm(d.estimate.price_rm)})</button>}
          </div>
        )}
      </section>
    </>
  );
}

export default function EventPage({ eventId }: { eventId: string }) {
  const q = useGetEvent(eventId);
  const qc = useQueryClient();
  const decide = useDecideEvent();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState('');
  const [declining, setDeclining] = useState(false);
  const d = q.data;

  async function act(action: 'approve' | 'decline' | 'cancel') {
    if (!d) return;
    if (action === 'cancel' && !window.confirm('Cancel this event? The crew will be told.')) return;
    setMsg(null);
    try {
      const r = await decide.mutateAsync({ eventId, data: { action, expected_version: d.version, note: note.trim() || undefined } });
      setMsg({ ok: true, text: r.message }); setDeclining(false); setNote('');
    } catch (e) { setMsg({ ok: false, text: errorText(e) }); }
    await qc.invalidateQueries({ queryKey: getGetEventQueryKey(eventId) });
    qc.invalidateQueries({ queryKey: getGetManagerDashboardQueryKey() });
  }

  if (q.isLoading) return <div className="mg-page"><Skeleton rows={4} /></div>;
  if (q.isError || !d) {
    return (
      <div className="mg-page">
        <Link href="/manager" className="mg-back" data-testid="link-back"><ArrowLeft size={15} />Dashboard</Link>
        {errorStatus(q.error) === 404 ? <div className="mg-card"><Empty title="Event not found" text="It may have been removed or is a past event." /></div> : <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      </div>
    );
  }
  const s = d.summary; const e = d.event;
  const upcoming = s.status === 'Approved' && s.date >= new Date().toISOString().slice(0, 10);

  return (
    <div className="mg-page" key={d.version}>
      <Link href="/manager" className="mg-back" data-testid="link-back"><ArrowLeft size={15} />Dashboard</Link>
      <header className="mg-hero">
        <img src={clipart(e.event_type)} alt="" />
        <div>
          <div className="eo-inline-actions" style={{ gap: 6, marginBottom: 6 }}>
            <span className={`mg-pill ${STATUS_TONE[s.status] ?? ''}`} data-testid="status-event">{s.status_label}</span>
            <span className="mg-pill grey">{s.id}</span>
            {e.repeat_client && <span className="mg-pill">Repeat customer</span>}
          </div>
          <h1 data-testid="text-event-name">{e.name}</h1>
          <p className="mg-sub">{fmtRange({ date: e.date, end_date: e.end_date, start_time: e.start_time, end_time: s.end_time })} · {e.venue_name ? `${e.venue_name}, ` : ''}{e.area} · {e.guests} guests</p>
        </div>
      </header>

      {msg && <div className={`eo-notice ${msg.ok ? 'eo-success' : 'eo-error'}`} style={{ margin: 0 }} data-testid="text-action-result">{msg.text}</div>}
      {d.decision_note && <div className="eo-notice" style={{ margin: 0 }} data-testid="text-decision-note">Note: {d.decision_note}</div>}

      {s.status === 'Pending' && (
        <div className="mg-decide" data-testid="card-decide">
          <p>This request is waiting for your decision.</p>
          {declining ? (
            <>
              <label className="eo-field" style={{ flex: '1 1 260px' }}>Note for the customer (optional)<input value={note} onChange={(x) => setNote(x.target.value)} data-testid="input-decline-note" /></label>
              <button className="eo-btn eo-btn-danger" onClick={() => act('decline')} disabled={decide.isPending} data-testid="button-confirm-decline"><X size={15} />Decline</button>
              <button className="eo-btn" onClick={() => setDeclining(false)} data-testid="button-cancel-decline">Back</button>
            </>
          ) : (
            <>
              <button className="eo-btn eo-btn-primary" onClick={() => act('approve')} disabled={decide.isPending} data-testid="button-approve"><Check size={16} />{decide.isPending ? 'Working…' : 'Approve'}</button>
              <button className="eo-btn eo-btn-danger" onClick={() => setDeclining(true)} data-testid="button-decline"><X size={16} />Decline</button>
            </>
          )}
        </div>
      )}
      {upcoming && (
        <div className="eo-inline-actions">
          <button className="eo-btn eo-btn-danger" onClick={() => act('cancel')} disabled={decide.isPending} data-testid="button-cancel-event"><Ban size={15} />Cancel event</button>
        </div>
      )}

      <div className="mg-grid2">
        <div className="eo-stack">
          <Editors d={d} onMsg={setMsg} />
          <StaffingEditor d={d} />
          <section className="mg-card" data-testid="card-staffing"><h2 style={{ marginBottom: 6 }}>Model recommendation</h2><StaffingList roles={d.staffing} /></section>
          <section className="mg-card" data-testid="card-equipment"><h2 style={{ marginBottom: 6 }}>Equipment check</h2><EquipmentTable lines={d.equipment} /></section>
        </div>
        <div className="eo-stack">
          <section className="mg-card" data-testid="card-details">
            <h2 style={{ marginBottom: 8 }}>Details</h2>
            <div className="mg-facts" style={{ gridTemplateColumns: '1fr' }}>
              <div><span>Type</span><strong>{e.event_type}</strong></div>
              <div><span>Client</span><strong data-testid="text-client">{e.client_name}{e.company_name ? `, ${e.company_name}` : ''}</strong></div>
              <div><span>Venue name</span><strong>{e.venue_name || 'Not named'}</strong></div>
              <div><span>Venue type</span><strong>{e.venue_type}</strong></div>
              <div><span>Dates</span><strong>{fmtRange({ date: e.date, end_date: e.end_date, start_time: e.start_time, end_time: s.end_time })}</strong></div>
              <div><span>Seating</span><strong>{e.seating_style}</strong></div>
              <div><span>Service</span><strong>{e.service_level}</strong></div>
              <div><span>Daily hours</span><strong>{e.duration_hours} h</strong></div>
              <div><span>Open to public</span><strong>{e.open_to_public ? 'Yes' : 'No'}</strong></div>
              <div><span>Distance</span><strong>{Math.round(d.estimate.distance_km)} km</strong></div>
              {d.estimate.peak_period && <div><span>Period</span><strong>{d.estimate.peak_period}</strong></div>}
            </div>
            {e.special_request && <><h3 className="mg-mini">Special request</h3><p className="eo-notes" data-testid="text-special-request">{e.special_request}</p></>}
            {d.estimate.warnings.length > 0 && <><h3 className="mg-mini">Watch out</h3><Warnings list={d.estimate.warnings} /></>}
          </section>
          <section className="mg-card" data-testid="card-client-history">
            <h2>Client history</h2>
            <p className="mg-muted" style={{ marginTop: 4 }}>{d.client.bookings} booking{d.client.bookings === 1 ? '' : 's'}{d.client.pattern ? ` · ${d.client.pattern}` : ''}</p>
            {d.client.usual_request && <p style={{ marginTop: 8, fontSize: 13 }}>Usually asks for: {d.client.usual_request}</p>}
            {d.client.past.length === 0 ? <p className="mg-muted" style={{ marginTop: 8 }}>First booking with us.</p> : (
              <ul className="mg-list" style={{ marginTop: 6 }}>
                {d.client.past.map((p, i) => <li key={i}><div><strong>{p.name}</strong><small>{shortDay(p.date)} · {p.guests} guests</small></div><span>{rm(p.price_rm)}</span></li>)}
              </ul>
            )}
          </section>
          <section className="mg-card" data-testid="card-activity">
            <h2 style={{ marginBottom: 12 }}>Activity</h2>
            {d.activity.length === 0 ? <p className="mg-muted">No activity yet.</p> : (
              <ul className="mg-activity">
                {d.activity.map((a, i) => (
                  <li key={i}><strong>{a.action}</strong><small>{a.actor} · {new Date(a.at).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small></li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
