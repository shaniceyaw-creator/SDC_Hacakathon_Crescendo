import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw, Inbox } from 'lucide-react';
import { useSyncLeave, getGetManagerDashboardQueryKey, getGetTeamQueryKey, type LeaveFeed } from '@workspace/api-client-react';
import { shortDay } from '@/lib/format';
import '@/styles/manager.css';

export function errorText(err: unknown, fallback = 'Something went wrong. Please try again.') {
  const e = err as { data?: { error?: string } | null; message?: string } | null;
  return e?.data?.error ?? fallback;
}
export const errorStatus = (err: unknown) => (err as { status?: number } | null)?.status;

export function PageHead({ eyebrow, title, sub, action }: { eyebrow?: string; title: string; sub?: string; action?: ReactNode }) {
  return (
    <header className="mg-head">
      <div>
        {eyebrow && <p className="mg-eyebrow">{eyebrow}</p>}
        <h1 data-testid="text-page-title">{title}</h1>
        {sub && <p className="mg-sub">{sub}</p>}
      </div>
      {action && <div className="mg-head-action">{action}</div>}
    </header>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mg-skel" aria-busy="true" data-testid="status-loading">
      <div className="mg-skel-bar wide" />
      <div className="mg-skel-grid">{Array.from({ length: rows }).map((_, i) => <div key={i} className="mg-skel-block" />)}</div>
      <div className="mg-skel-bar" /><div className="mg-skel-bar short" />
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="eo-notice eo-error" role="alert" data-testid="status-error">
      <AlertTriangle size={18} />
      <div className="eo-error-content">
        <strong>Could not load this page.</strong>
        <div>{errorText(error, 'Please check your connection and try again.')}</div>
        <button className="eo-text-btn" onClick={onRetry} data-testid="button-retry">Try again</button>
      </div>
    </div>
  );
}

export function Empty({ title, text, icon }: { title: string; text?: string; icon?: ReactNode }) {
  return (
    <div className="eo-empty" data-testid="status-empty">
      <div className="eo-empty-icon">{icon ?? <Inbox size={20} />}</div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
    </div>
  );
}

export function LeaveCard({ leave }: { leave: LeaveFeed }) {
  const qc = useQueryClient();
  const sync = useSyncLeave();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run() {
    setMsg(null);
    try {
      const r = await sync.mutateAsync();
      setMsg({ ok: true, text: r.changes.length ? `${r.changes.length} change${r.changes.length > 1 ? 's' : ''} brought in.` : 'Leave is up to date. No changes.' });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetManagerDashboardQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetTeamQueryKey() }),
      ]);
    } catch (e) { setMsg({ ok: false, text: errorText(e, 'Could not reach Orbyte. Please try again.') }); }
  }
  return (
    <section className="mg-card mg-leave" data-testid="card-leave">
      <div className="mg-card-head">
        <div>
          <h2>Staff leave</h2>
          <p className="mg-muted" data-testid="text-leave-synced">
            {leave.synced_at ? `Last synced ${new Date(leave.synced_at).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Not synced yet'}
          </p>
        </div>
        <button className="eo-btn eo-btn-primary" onClick={run} disabled={sync.isPending} data-testid="button-sync-leave">
          <RefreshCw size={15} className={sync.isPending ? 'mg-spin' : ''} />{sync.isPending ? 'Syncing…' : 'Sync leave from Orbyte'}
        </button>
      </div>
      {msg && <div className={`eo-notice ${msg.ok ? 'eo-success' : 'eo-error'}`} data-testid="text-leave-sync-result">{msg.text}</div>}
      {leave.changes.length > 0 && (
        <ul className="mg-changes" data-testid="list-leave-changes">{leave.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
      )}
      <h3 className="mg-mini">Away in the next 14 days</h3>
      {leave.away_next_14_days.length === 0 ? <p className="mg-muted">Everyone is available.</p> : (
        <ul className="mg-away">
          {leave.away_next_14_days.map((a, i) => (
            <li key={`${a.staff_id}-${i}`} data-testid={`row-away-${a.staff_id}`}>
              <span className="mg-avatar">{a.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
              <div><strong>{a.name}</strong><small>{a.role}</small></div>
              <span className={`mg-pill ${a.status.toLowerCase().includes('pend') ? 'amber' : 'peach'}`}>
                {shortDay(a.start)}{a.end !== a.start ? ` – ${shortDay(a.end)}` : ''}{a.status.toLowerCase().includes('pend') ? ' (pending)' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
