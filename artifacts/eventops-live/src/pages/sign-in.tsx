import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { BrandMark } from '@/components/brand-mark';
import { ArrowRight, Briefcase, Loader2, PartyPopper, ShieldCheck } from 'lucide-react';
import { useListAccounts, type Account } from '@workspace/api-client-react';
import { homeFor, useAuth } from '@/lib/auth';
import { ErrorState, errMsg } from '@/components/people/bits';
import '@/styles/people.css';

const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

const PERSP = [
  { role: 'manager' as const, title: 'Manager / Admin', line: 'Approve plans, prices and crew.', Icon: ShieldCheck },
  { role: 'worker' as const, title: 'Worker', line: 'See your jobs and pick up extra shifts.', Icon: Briefcase },
  { role: 'customer' as const, title: 'Customer', line: 'Request an event or join one.', Icon: PartyPopper },
];

export default function SignIn() {
  useEffect(() => { document.title = 'Sign in · OpusEvents'; }, []);
  const accounts = useListAccounts();
  const { signIn } = useAuth();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(a: Account) {
    setBusy(a.id); setError(null);
    try {
      const acc = await signIn(a.id);
      navigate(homeFor(acc.role));
    } catch (e) {
      setError(errMsg(e, 'Sign-in failed. Please try again.'));
      setBusy(null);
    }
  }

  const btn = (a: Account) => (
    <button key={a.id} className="pp-acct" onClick={() => pick(a)} disabled={!!busy} data-testid={`button-account-${a.id}`}>
      <span className="pp-acct-av" aria-hidden>{initials(a.name)}</span>
      <span><strong>{a.name}</strong><small>{a.title}</small></span>
      <span>{busy === a.id ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />}</span>
    </button>
  );

  const featured = accounts.data?.featured ?? [];
  const staff = accounts.data?.staff ?? [];

  return (
    <div className="eo-preview pp-signin">
      <div className="pp-signin-inner">
        <div className="pp-signin-top pp-rise">
          <span className="eo-brand"><BrandMark size={36} />OpusEvents</span>
          <span className="pp-demo-chip" data-testid="text-demo-note">Demo with made-up data</span>
        </div>
        <h1 className="pp-rise-2">Events across KL &amp; Selangor, <em>planned together.</em></h1>
        <p className="pp-signin-lede pp-rise-2">Pick who you want to be. No password needed.</p>
        {error && <div className="eo-notice eo-error" role="alert" data-testid="text-signin-error">{error}</div>}
        {accounts.isError ? <div style={{ marginTop: 30 }}><ErrorState error={accounts.error} onRetry={() => accounts.refetch()} /></div> : (
          <div className="pp-persp pp-rise-3">
            {PERSP.map(({ role, title, line, Icon }) => {
              const list = featured.filter((a) => a.role === role);
              const extra = role === 'worker' ? staff.filter((s) => !list.some((l) => l.id === s.id)) : [];
              return (
                <section key={role} className="pp-persp-col" data-p={role} data-testid={`section-perspective-${role}`}>
                  <span className="pp-persp-ico"><Icon size={22} /></span>
                  <h2>{title}</h2>
                  <p>{line}</p>
                  <div className="pp-accts">
                    {accounts.isLoading ? <><div className="pp-skel" /><div className="pp-skel" /></> : list.map(btn)}
                  </div>
                  {extra.length > 0 && (
                    <details className="pp-more">
                      <summary data-testid="button-more-workers">More workers ({extra.length})</summary>
                      <div className="pp-accts">{extra.map(btn)}</div>
                    </details>
                  )}
                </section>
              );
            })}
          </div>
        )}
        <p className="pp-signin-foot">OpusEvents by Crescendo · Petaling Jaya, Malaysia. All names, events and prices here are synthetic.</p>
      </div>
    </div>
  );
}
