import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save, RefreshCw } from 'lucide-react';
import { useSaveEventStaffing, getGetEventQueryKey, type EventDetail, type ShiftSelection } from '@workspace/api-client-react';
import { ROLE_LABEL } from '@/lib/format';
import { endsNextDay, shiftIssue } from '@/lib/shift-time';
import { invalidateBookingData } from '@/lib/invalidate';
import { errorText, errorStatus } from '@/components/manager/common';
import '@/styles/bookings.css';

type Row = { on: boolean; start: string; end: string };

export function StaffingEditor({ d }: { d: EventDetail }) {
  const qc = useQueryClient();
  const save = useSaveEventStaffing();
  const id = d.summary.id;
  const editable = d.summary.status === 'Pending' || d.summary.status === 'Approved';
  const options = d.staff_options ?? [];
  const [rows, setRows] = useState<Record<string, Row>>(() => {
    const m: Record<string, Row> = {};
    options.forEach((o) => { m[o.id] = { on: false, start: d.summary.start_time, end: d.summary.end_time }; });
    (d.shift_selections ?? []).forEach((s) => { m[s.staff_id] = { on: true, start: s.start_time, end: s.end_time }; });
    return m;
  });
  const [msg, setMsg] = useState<{ ok: boolean; text: string; conflict?: boolean } | null>(null);
  const patch = (sid: string, p: Partial<Row>) => setRows((r) => ({ ...r, [sid]: { ...r[sid], ...p } }));

  async function send(useRec: boolean) {
    setMsg(null);
    const selections: ShiftSelection[] = useRec ? [] : options.filter((o) => rows[o.id]?.on).map((o) => ({ staff_id: o.id, role: o.role, start_time: rows[o.id].start, end_time: rows[o.id].end }));
    if (!useRec) {
      const bad = options.find((o) => rows[o.id]?.on && shiftIssue(rows[o.id].start, rows[o.id].end));
      if (bad) { setMsg({ ok: false, text: `${bad.name}: ${shiftIssue(rows[bad.id].start, rows[bad.id].end)}` }); return; }
    }
    try {
      await save.mutateAsync({ eventId: id, data: { expected_version: d.version, selections, ...(useRec ? { use_recommendation: true } : {}) } });
      await invalidateBookingData(qc, id);
      setMsg({ ok: true, text: useRec ? 'Back to the recommended crew.' : selections.length ? 'Staffing saved.' : 'Saved with no workers selected.' });
    } catch (e) { setMsg({ ok: false, text: errorText(e), conflict: errorStatus(e) === 409 }); }
  }

  return (
    <section className="mg-card" data-testid="card-staff-editor">
      <div className="mg-card-head">
        <div><h2>Workers and shifts</h2><p className="mg-muted">Same shift hours on every event day. An end time earlier than the start means the next day. Unavailable people can still be tried; the server checks the times.</p></div>
        {editable && (
          <div className="eo-inline-actions">
            <button className="eo-btn" onClick={() => send(true)} disabled={save.isPending} data-testid="button-staff-reset"><RotateCcw size={14} />Use recommendation</button>
            <button className="eo-btn eo-btn-primary" onClick={() => send(false)} disabled={save.isPending} data-testid="button-staff-save"><Save size={14} />{save.isPending ? 'Saving…' : 'Save staffing'}</button>
          </div>
        )}
      </div>
      {editable && (
        <div className="eo-notice" style={{ margin: '0 0 10px' }} data-testid="notice-staff-warning">
          Custom shorter shifts do not guarantee full-day role coverage. Saving replaces the existing assignments and any open extra shifts for this confirmed event.
        </div>
      )}
      {msg && (
        <div className={`eo-notice ${msg.ok ? 'eo-success' : 'eo-error'}`} role="status" style={{ margin: '0 0 10px' }} data-testid="text-staff-result">
          {msg.text}
          {msg.conflict && <button className="eo-text-btn" style={{ marginLeft: 8 }} onClick={() => qc.invalidateQueries({ queryKey: getGetEventQueryKey(id) })} data-testid="button-staff-reload"><RefreshCw size={12} /> Reload latest</button>}
        </div>
      )}
      {options.length === 0 ? <p className="mg-muted">No staff list for this event.</p> : options.map((o) => {
        const r = rows[o.id];
        return (
          <div className="bk-staff" key={o.id} data-testid={`row-staff-${o.id}`}>
            <input type="checkbox" checked={r.on} disabled={!editable} onChange={(e) => patch(o.id, { on: e.target.checked })} aria-label={`Assign ${o.name}`} data-testid={`check-staff-${o.id}`} />
            <div>
              <strong>{o.name}</strong>
              <small>{ROLE_LABEL[o.role] ?? o.role}</small>
              {!o.available && <span className="mg-pill red" style={{ marginTop: 4 }} data-testid={`text-unavailable-${o.id}`}>{o.reason || 'Unavailable'}</span>}
            </div>
            <div className="times">
              <input type="time" value={r.start} disabled={!editable || !r.on} onChange={(e) => patch(o.id, { start: e.target.value })} aria-label="Shift start" />
              <span>–</span>
              <div className="bk-shift-end">
                <input type="time" value={r.end} disabled={!editable || !r.on} onChange={(e) => patch(o.id, { end: e.target.value })} aria-label="Shift end" />
                {endsNextDay(r.start, r.end) && <small data-testid={`text-shift-next-day-${o.id}`}>Next day</small>}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
