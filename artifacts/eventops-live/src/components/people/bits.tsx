import type { ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

export function errMsg(e: unknown, fallback = 'Something went wrong. Please try again.') {
  const d = (e as { data?: { error?: string } } | null)?.data;
  if (d && typeof d.error === 'string') return d.error;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

export function PageHead({ kicker, title, sub, action }: { kicker?: string; title: string; sub?: string; action?: ReactNode }) {
  return (
    <header className="pp-head pp-rise">
      <div>
        {kicker && <p className="pp-kicker">{kicker}</p>}
        <h1 data-testid="text-page-title">{title}</h1>
        {sub && <p className="pp-sub">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

export function Skel({ rows = 3, tall = false }: { rows?: number; tall?: boolean }) {
  return (
    <div className="pp-skelwrap" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className={'pp-skel' + (tall ? ' tall' : '')} />)}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="eo-notice eo-error" role="alert" data-testid="status-error">
      <AlertTriangle size={18} />
      <div className="eo-error-content">
        <strong>We could not load this.</strong>
        <div>{errMsg(error)}</div>
        <button className="eo-text-btn" onClick={onRetry} data-testid="button-retry"><RotateCw size={13} />Try again</button>
      </div>
    </div>
  );
}

export function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="pp-empty" data-testid="status-empty">
      <span className="pp-empty-icon">{icon}</span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}
