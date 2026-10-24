import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, Save } from 'lucide-react';
import { applyType, changeStartDate, checkBooking, defaultsFor, fmtRange, toInput, type BookingForm } from '@/lib/booking';
import { BookingFields } from '@/components/booking/booking-fields';
import {
  useGetOptions, useEstimateEvent, useCreateEvent, getGetManagerDashboardQueryKey, type EventInput, type EstimateResult,
} from '@workspace/api-client-react';
import { ROLE_LABEL } from '@/lib/format';
import { PageHead, Skeleton, ErrorState, errorText } from '@/components/manager/common';
import { MoneyRow, Warnings, EquipmentTable, StaffingList, ROLES } from '@/components/manager/estimate';

type Extra = { name: string; client_name: string; company_name: string };

export default function NewEvent() {
  const opts = useGetOptions();
  const estimate = useEstimateEvent();
  const create = useCreateEvent();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [f, setF] = useState<BookingForm | null>(null);
  const [x, setX] = useState<Extra>({ name: '', client_name: '', company_name: '' });
  const [result, setResult] = useState<EstimateResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inited = useRef(false);
  const o = opts.data;

  useEffect(() => {
    if (!o || inited.current) return;
    inited.current = true;
    setF(defaultsFor(o, 'manager'));
  }, [o]);

  const set = <K extends keyof BookingForm>(k: K, v: BookingForm[K]) => { setF((p) => (p ? { ...p, [k]: v } : p)); setResult(null); };
  const onStart = (date: string) => { setF((p) => (p && o ? changeStartDate(p, date, o) : p)); setResult(null); };
  const changeType = (name: string) => { if (o) { setF((p) => (p ? applyType(o, p, name, 'manager') : p)); setResult(null); } };

  const body = (): EventInput | null => f && ({
    name: x.name.trim(), ...toInput(f), client_name: x.client_name.trim() || undefined, company_name: x.company_name.trim() || undefined,
  });

  async function onEstimate(e: FormEvent) {
    e.preventDefault(); setErr(null);
    const b = body(); if (!b || !o || !f) return;
    if (!b.name) { setErr('Please give the event a name.'); return; }
    const c = checkBooking(f, o, 'manager'); if (c.errors.length) { setErr(c.errors[0]); return; }
    try { setResult(await estimate.mutateAsync({ data: { event: b } })); } catch (er) { setErr(errorText(er)); }
  }
  async function onSave() {
    setErr(null); const b = body(); if (!b) return;
    try {
      const r = await create.mutateAsync({ data: { event: b } });
      await qc.invalidateQueries({ queryKey: getGetManagerDashboardQueryKey() });
      navigate(`/manager/events/${r.id}`);
    } catch (er) { setErr(errorText(er)); }
  }

  return (
    <div className="mg-page">
      <PageHead eyebrow="Manual entry" title="New event" sub="Fill in the details and get the model's estimate." />
      {opts.isLoading ? <Skeleton /> : opts.isError || !o ? <ErrorState error={opts.error} onRetry={() => opts.refetch()} /> : !f ? <Skeleton /> : (
        <div className="mg-grid2">
          <form className="mg-card" onSubmit={onEstimate} data-testid="form-new-event">
            <div className="eo-stack">
              <label className="eo-field full">Event name<input value={x.name} onChange={(e) => { setX({ ...x, name: e.target.value }); setResult(null); }} placeholder="e.g. Sunway Annual Dinner" data-testid="input-name" /></label>
              <BookingFields o={o} f={f} role="manager" set={set} onType={changeType} onStart={onStart} />
              <div className="mg-form">
                <label className="eo-field">Client name<input value={x.client_name} onChange={(e) => setX({ ...x, client_name: e.target.value })} data-testid="input-client-name" /></label>
                <label className="eo-field">Company<input value={x.company_name} onChange={(e) => setX({ ...x, company_name: e.target.value })} data-testid="input-company" /></label>
              </div>
            </div>
            {err && <div className="eo-notice eo-error" data-testid="text-form-error">{err}</div>}
            <div className="mg-big-actions">
              <button type="submit" className="eo-btn eo-btn-primary" disabled={estimate.isPending} data-testid="button-estimate">
                <Sparkles size={16} />{estimate.isPending ? 'Estimating…' : 'Get estimate'}
              </button>
            </div>
          </form>

          <div className="eo-stack">
            {estimate.isPending ? <div className="mg-card"><Skeleton rows={4} /></div> : !result ? (
              <div className="mg-card" style={{ background: 'var(--eo-mint)' }}>
                <h2>Estimate</h2>
                <p className="mg-muted" style={{ marginTop: 6 }}>Press "Get estimate" to see crew, equipment and price.</p>
              </div>
            ) : (
              <>
                <section className="mg-card" data-testid="card-estimate">
                  <div className="mg-card-head"><h2>Estimate</h2>{result.estimate.peak_period && <span className="mg-pill amber" data-testid="text-peak">{result.estimate.peak_period}</span>}</div>
                  <MoneyRow est={result.estimate} />
                  <div className="bk-facts" data-testid="preapproval-facts">
                    <div><span>When: </span>{fmtRange(result.event)}</div>
                    <div><span>Venue: </span>{result.event.venue_name || 'Not named'}</div>
                    <div><span>Area: </span>{result.event.area}</div>
                    <div><span>Distance: </span>{Math.round(result.estimate.distance_km)} km from base</div>
                  </div>
                  <h3 className="mg-mini">Crew ({result.estimate.crew_total})</h3>
                  <div className="mg-crew">{ROLES.map((r) => <div key={r}><small>{ROLE_LABEL[r]}</small><strong data-testid={`text-crew-${r}`}>{result.estimate.crew[r]}</strong></div>)}</div>
                  {result.estimate.warnings.length > 0 && <><h3 className="mg-mini">Watch out</h3><Warnings list={result.estimate.warnings} /></>}
                  <div className="mg-big-actions">
                    <button className="eo-btn eo-btn-primary" onClick={onSave} disabled={create.isPending} data-testid="button-save">
                      <Save size={16} />{create.isPending ? 'Saving…' : 'Save for approval'}
                    </button>
                  </div>
                </section>
                {result.staffing && <section className="mg-card"><h2 style={{ marginBottom: 6 }}>Staffing</h2><StaffingList roles={result.staffing} /></section>}
                {result.equipment && <section className="mg-card"><h2 style={{ marginBottom: 6 }}>Equipment</h2><EquipmentTable lines={result.equipment} /></section>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
