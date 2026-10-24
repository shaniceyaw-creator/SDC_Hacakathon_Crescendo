import { TypeBadge } from '@/components/bookings/type-badge';
import '@/styles/booking-list.css';
import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Plus, Trash2, Paperclip } from 'lucide-react';
import {
  useGetBookingProgress, useUpdateBookingProgress, getGetBookingProgressQueryKey, type BookingExpense, type ProgressInput,
  type ProgressTask,
} from '@workspace/api-client-react';
import { fmtRange } from '@/lib/booking';
import { invalidateBookingData } from '@/lib/invalidate';
import { Skeleton, ErrorState, errorText, errorStatus } from '@/components/manager/common';
import '@/styles/bookings.css';

const STATUSES = ['Not started', 'In progress', 'Done', 'Blocked'] as const;
const rm = (value: number) => new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', minimumFractionDigits: 2 }).format(value);
const TONE: Record<string, string> = { 'Not started': 'grey', 'In progress': 'amber', Done: '', Blocked: 'red' };
type Send = (p: Omit<ProgressInput, 'expected_version'>) => Promise<boolean>;
type Receipt = { path: string; name: string };

async function uploadReceipt(eventId: string, file: File): Promise<Receipt> {
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) throw new Error('Receipts must be a JPEG, PNG or PDF file.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Receipts can be 5 MB at most.');
  const r = await fetch(`${import.meta.env.BASE_URL}api/bookings/${eventId}/receipts`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) }, body: file,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? 'Receipt upload failed.');
  return r.json();
}
const receiptUrl = (eventId: string, path: string) => `${import.meta.env.BASE_URL}api/bookings/${eventId}/receipts/${path.split('/').pop()}`;
const when = (s: string) => s && Number.isFinite(Date.parse(s))
  ? new Date(s).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';

function TaskRow({ t, send, busy }: { t: ProgressTask; send: Send; busy: boolean }) {
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(t.title); const [note, setNote] = useState(t.note);
  return (
    <div className="bk-row" data-testid={`row-task-${t.id}`}>
      <div className="bk-row-top">
        <div style={{ minWidth: 0 }}>
          {edit ? <input className="bk-sel" style={{ width: '100%' }} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Task title" data-testid={`input-task-title-${t.id}`} /> : <h3>{t.title}</h3>}
          <small>{t.updated_by}{when(t.updated_at) ? ` · ${when(t.updated_at)}` : ''}</small>
        </div>
        <div className="eo-inline-actions" style={{ gap: 6 }}>
          <span className={`mg-pill ${TONE[t.status] ?? ''}`}>{t.status}</span>
          <select className="bk-sel" value={t.status} disabled={busy} aria-label="Status" onChange={(e) => send({ action: 'update_task', item_id: t.id, status: e.target.value as typeof STATUSES[number] })} data-testid={`select-task-status-${t.id}`}>
            {STATUSES.map((x) => <option key={x}>{x}</option>)}
          </select>
          <button className="eo-btn" onClick={() => setEdit(!edit)} aria-label="Edit task" data-testid={`button-edit-task-${t.id}`}><Pencil size={13} /></button>
          <button className="eo-btn eo-btn-danger" disabled={busy} aria-label="Delete task" data-testid={`button-delete-task-${t.id}`}
            onClick={() => { if (window.confirm(`Delete task "${t.title}"?`)) void send({ action: 'delete_task', item_id: t.id }); }}><Trash2 size={13} /></button>
        </div>
      </div>
      {edit ? (
        <>
          <textarea className="bk-sel" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" aria-label="Task note" data-testid={`input-task-note-${t.id}`} />
          <div className="eo-inline-actions">
            <button className="eo-btn eo-btn-primary" disabled={busy || !title.trim()} data-testid={`button-save-task-${t.id}`}
              onClick={async () => { if (await send({ action: 'update_task', item_id: t.id, title: title.trim(), note })) setEdit(false); }}>{busy ? 'Saving…' : 'Save'}</button>
            <button className="eo-btn" onClick={() => { setEdit(false); setTitle(t.title); setNote(t.note); }}>Cancel</button>
          </div>
        </>
      ) : t.note && <div className="bk-note">{t.note}</div>}
    </div>
  );
}

function FileInput({ onFile, file }: { onFile: (f: File | null) => void; file: File | null }) {
  return (
    <label className="eo-field">Receipt (optional, JPEG, PNG or PDF, 5 MB)
      <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => onFile(e.target.files?.[0] ?? null)} data-testid="input-receipt" />
      {file && <small className="mg-muted">{file.name}</small>}
      <a className="eo-btn" style={{ alignSelf: 'flex-start', marginTop: 6 }} href={`${import.meta.env.BASE_URL}api/receipt-auth/start?returnTo=${encodeURIComponent(window.location.pathname)}`} target="_blank" rel="noreferrer" data-testid="link-receipt-signin">Sign in with Replit for receipts</a>
      <small className="mg-muted">Opens a new tab. After you sign in, come back here and retry. Only receipt files need this; tasks, budget and expenses without attachments do not. Demo files only, not a secure finance system.</small>
    </label>
  );
}

function ExpenseRow({ x, eventId, send, busy, onErr }: { x: BookingExpense; eventId: string; send: Send; busy: boolean; onErr: (m: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(x.title); const [amount, setAmount] = useState(String(x.amount)); const [file, setFile] = useState<File | null>(null);
  const [up, setUp] = useState(false);
  async function save() {
    let rc: Receipt | null = null;
    if (file) { setUp(true); try { rc = await uploadReceipt(eventId, file); } catch (e) { onErr(e instanceof Error ? e.message : 'Upload failed.'); setUp(false); return; } setUp(false); }
    if (await send({ action: 'update_expense', item_id: x.id, title: title.trim(), amount: Number(amount), ...(rc ? { receipt_path: rc.path, receipt_name: rc.name } : {}) })) { setEdit(false); setFile(null); }
  }
  return (
    <div className="bk-row" data-testid={`row-expense-${x.id}`}>
      <div className="bk-row-top">
        <div style={{ minWidth: 0 }}>
          {edit ? null : <h3>{x.title}</h3>}
          <small>{x.updated_by} · {when(x.updated_at)}</small>
          {x.receipt_path && <a className="eo-text-btn" href={receiptUrl(eventId, x.receipt_path)} target="_blank" rel="noreferrer" data-testid={`link-receipt-${x.id}`}><Paperclip size={12} /> {x.receipt_name || 'Demo receipt'}</a>}
        </div>
        <div className="eo-inline-actions" style={{ gap: 6 }}>
          {!edit && <strong>{rm(x.amount)}</strong>}
          <button className="eo-btn" onClick={() => setEdit(!edit)} aria-label="Edit expense" data-testid={`button-edit-expense-${x.id}`}><Pencil size={13} /></button>
          <button className="eo-btn eo-btn-danger" disabled={busy} aria-label="Delete expense" data-testid={`button-delete-expense-${x.id}`}
            onClick={() => { if (window.confirm(`Delete expense "${x.title}"?`)) void send({ action: 'delete_expense', item_id: x.id }); }}><Trash2 size={13} /></button>
        </div>
      </div>
      {edit && (
        <>
          <div className="bk-inline">
            <label className="eo-field">Title<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label className="eo-field">Amount (RM)<input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          </div>
          <FileInput file={file} onFile={setFile} />
          <div className="eo-inline-actions">
            <button className="eo-btn eo-btn-primary" disabled={busy || up || !title.trim() || amount === ''} onClick={save} data-testid={`button-save-expense-${x.id}`}>{busy || up ? 'Saving…' : 'Save'}</button>
            <button className="eo-btn" onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function BookingDetail({ base, eventId }: { base: 'manager' | 'worker'; eventId: string }) {
  const qc = useQueryClient();
  const q = useGetBookingProgress(eventId, { query: { queryKey: getGetBookingProgressQueryKey(eventId), refetchInterval: 30000 } });
  const update = useUpdateBookingProgress();
  const mutRef = useRef(update.mutateAsync); mutRef.current = update.mutateAsync;
  const d = q.data; const dRef = useRef(d); dRef.current = d;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tTitle, setTTitle] = useState(''); const [tNote, setTNote] = useState('');
  const [eTitle, setETitle] = useState(''); const [eAmt, setEAmt] = useState(''); const [eFile, setEFile] = useState<File | null>(null); const [eRc, setERc] = useState<Receipt | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const isManager = base === 'manager';

  const send: Send = async (p) => {
    if (busyRef.current || !dRef.current) return false;
    busyRef.current = true; setBusy(true); setErr(null);
    try {
      await mutRef.current({ eventId, data: { expected_version: dRef.current.version, ...p } });
      await invalidateBookingData(qc, eventId);
      return true;
    } catch (e) {
      setErr(errorStatus(e) === 409 ? 'Someone else changed this booking. The latest version is loading, please try again.' : errorText(e));
      if (errorStatus(e) === 409) await qc.invalidateQueries({ queryKey: getGetBookingProgressQueryKey(eventId) });
      return false;
    } finally { busyRef.current = false; setBusy(false); }
  };

  async function addTask(e: FormEvent) {
    e.preventDefault();
    if (await send({ action: 'add_task', title: tTitle.trim(), note: tNote.trim(), status: 'Not started' })) { setTTitle(''); setTNote(''); }
  }
  async function addExpense(e: FormEvent) {
    e.preventDefault();
    let rc = eRc;
    if (eFile && !rc) {
      setBusy(true);
      try { rc = await uploadReceipt(eventId, eFile); setERc(rc); } catch (x) { setErr(x instanceof Error ? x.message : 'Upload failed.'); setBusy(false); return; }
      setBusy(false);
    }
    if (await send({ action: 'add_expense', title: eTitle.trim(), amount: Number(eAmt), ...(rc ? { receipt_path: rc.path, receipt_name: rc.name } : {}) })) { setETitle(''); setEAmt(''); setEFile(null); setERc(null); }
  }

  const back = <Link href={`/${base}/bookings`} className="mg-back" data-testid="link-back"><ArrowLeft size={15} />Bookings</Link>;
  if (q.isLoading) return <div className="mg-page"><Skeleton rows={5} /></div>;
  if (q.isError || !d) return <div className="mg-page">{back}<ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  const e = d.event; const pct = d.budget > 0 ? Math.min(100, (d.spent / d.budget) * 100) : 0;

  return (
    <div className="mg-page">
      {back}
      <header className="mg-head">
        <div>
          <p className="mg-eyebrow">{e.id}</p>
          <TypeBadge type={e.event_type} />
          <h1 data-testid="text-booking-name">{e.name}</h1>
          <p className="mg-sub">{fmtRange(e)} · {e.venue_name ? `${e.venue_name}, ` : ''}{e.area}</p>
        </div>
        {isManager && <Link href={`/manager/events/${e.id}`} className="eo-btn" data-testid="link-event-page">Event details</Link>}
      </header>
      {err && <div className="eo-notice eo-error" role="alert" style={{ margin: 0 }} data-testid="text-progress-error">{err}</div>}

      <section className="mg-card" data-testid="card-budget">
        <div className="mg-card-head"><h2>Budget</h2><span className="bk-demo">Demo figures</span></div>
        <div className="bk-money">
          <div><small>Budget</small><strong data-testid="text-budget">{rm(d.budget)}</strong></div>
          <div><small>Spent (recorded expenses)</small><strong data-testid="text-spent">{rm(d.spent)}</strong></div>
          <div><small>Remaining</small><strong data-testid="text-remaining">{rm(d.remaining)}</strong></div>
        </div>
        <div className="bk-meter"><i className={d.remaining < 0 ? 'over' : ''} style={{ width: `${pct}%` }} /></div>
        <p className="bk-fine">Starts at the predicted cost. Remaining budget subtracts recorded expenses only, not the estimate again.</p>
        <p className="bk-fine">Planned Orbyte handoff: a future connection could share booking expenses and receipts with finance as they are saved. This demo does not send data to Orbyte and has no finance-role screen.</p>
        {isManager ? (
          <div className="bk-inline" style={{ marginTop: 10 }}>
            <label className="eo-field">Set budget (RM)<input type="number" min={0} value={budget ?? String(d.budget)} onChange={(x) => setBudget(x.target.value)} data-testid="input-budget" /></label>
            <button className="eo-btn eo-btn-primary" disabled={busy || budget === null || budget === ''} data-testid="button-save-budget"
              onClick={async () => { if (await send({ action: 'set_budget', amount: Number(budget) })) setBudget(null); }}>{busy ? 'Saving…' : 'Save budget'}</button>
          </div>
        ) : <p className="bk-fine">Only the manager can change the budget.</p>}
      </section>

      <div className="mg-grid2">
        <section className="mg-card" data-testid="card-tasks">
          <div className="mg-card-head"><h2>Tasks</h2></div>
          {d.tasks.length === 0 ? <p className="mg-muted">No tasks yet. Add the first one below.</p> : d.tasks.map((t) => <TaskRow key={t.id} t={t} send={send} busy={busy} />)}
          <form className="bk-inline" style={{ marginTop: 14 }} onSubmit={addTask}>
            <label className="eo-field">New task<input required value={tTitle} onChange={(x) => setTTitle(x.target.value)} data-testid="input-new-task" /></label>
            <label className="eo-field">Note<input value={tNote} onChange={(x) => setTNote(x.target.value)} data-testid="input-new-task-note" /></label>
            <button className="eo-btn eo-btn-primary" disabled={busy || !tTitle.trim()} data-testid="button-add-task"><Plus size={14} />Add task</button>
          </form>
        </section>
        <section className="mg-card" data-testid="card-expenses">
          <div className="mg-card-head"><h2>Expenses</h2><span className="bk-demo">Demo receipts</span></div>
          {d.expenses.length === 0 ? <p className="mg-muted">No expenses recorded.</p> : d.expenses.map((x) => <ExpenseRow key={x.id} x={x} eventId={eventId} send={send} busy={busy} onErr={setErr} />)}
          <form className="eo-stack" style={{ marginTop: 14 }} onSubmit={addExpense}>
            <div className="bk-inline">
              <label className="eo-field">Expense<input required value={eTitle} onChange={(x) => setETitle(x.target.value)} data-testid="input-new-expense" /></label>
              <label className="eo-field">Amount (RM)<input required type="number" min={0} step="0.01" value={eAmt} onChange={(x) => setEAmt(x.target.value)} data-testid="input-new-expense-amount" /></label>
            </div>
            <FileInput file={eFile} onFile={(f) => { setEFile(f); setERc(null); }} />
            <button className="eo-btn eo-btn-primary" disabled={busy || !eTitle.trim() || eAmt === ''} data-testid="button-add-expense"><Plus size={14} />{busy ? 'Saving…' : 'Add expense'}</button>
          </form>
        </section>
      </div>

      <section className="mg-card" data-testid="card-progress-activity">
        <h2 style={{ marginBottom: 12 }}>Activity</h2>
        <p className="bk-fine" style={{ marginBottom: 8 }}>Refreshes every 30 seconds.</p>
        {d.activity.length === 0 ? <p className="mg-muted">No activity yet.</p> : (
          <ul className="mg-activity">{d.activity.map((a, i) => <li key={i}><strong>{a.action}</strong><small>{a.actor} · {when(a.at)}</small></li>)}</ul>
        )}
      </section>
    </div>
  );
}
