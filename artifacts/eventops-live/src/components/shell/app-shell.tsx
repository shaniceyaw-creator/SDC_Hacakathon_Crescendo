import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  BarChart3, Briefcase, CalendarDays, HandCoins, Home, LayoutDashboard, Menu, MessageSquare,
  PartyPopper, ClipboardList, Info, RotateCcw, Ticket, Users, X, ArrowLeftRight,
} from 'lucide-react';
import type { Account } from '@workspace/api-client-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/lib/auth';
import { BrandMark } from '@/components/brand-mark';
import './shell.css';
import '@/styles/music.css';

type NavItem = { href: string; label: string; icon: typeof Home };

const NAV: Record<Account['role'], NavItem[]> = {
  manager: [
    { href: '/manager', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/manager/bookings', label: 'Confirmed bookings', icon: ClipboardList },
    { href: '/manager/insights', label: 'Insights', icon: BarChart3 },
    { href: '/manager/calendar', label: 'Calendar', icon: CalendarDays },
    { href: '/manager/team', label: 'Team & data', icon: Users },
    { href: '/manager/assistant', label: 'Assistant', icon: MessageSquare },
    { href: '/manager/about', label: 'About us', icon: Info },
  ],
  worker: [
    { href: '/worker', label: 'My jobs', icon: Briefcase },
    { href: '/worker/shifts', label: 'Open shifts', icon: HandCoins },
    { href: '/worker/bookings', label: 'Team bookings', icon: ClipboardList },
    { href: '/worker/calendar', label: 'Calendar', icon: CalendarDays },
    { href: '/worker/about', label: 'About us', icon: Info },
  ],
  customer: [
    { href: '/customer', label: 'Home', icon: Home },
    { href: '/customer/organise', label: 'Organise an event', icon: PartyPopper },
    { href: '/customer/events', label: 'Join an event', icon: Ticket },
    { href: '/customer/about', label: 'About us', icon: Info },
  ],
};

const ROLE_NAME: Record<Account['role'], string> = { manager: 'Manager', worker: 'Worker', customer: 'Customer' };

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

function isActive(location: string, href: string, root: string) {
  return href === root ? location === href : location === href || location.startsWith(`${href}/`);
}

export function AppShell({ account, children }: { account: Account; children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { signOut, resetDemo, resetting } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const items = NAV[account.role];
  const root = items[0].href;
  const isEventPage = location.startsWith('/manager/events/');

  // Browser tab shows the current section, e.g. "Open shifts · OpusEvents".
  const current = isEventPage ? 'Review event' : items.find(({ href }) => isActive(location, href, root))?.label;
  useEffect(() => {
    document.title = current ? `${current} · OpusEvents` : 'OpusEvents';
  }, [current]);

  async function switchAccount() {
    await signOut();
    navigate('/sign-in');
  }

  async function reset() {
    try {
      const events = await resetDemo();
      setNotice(`Demo reset: ${events} bookings restored.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Reset failed. Please retry.');
    }
    setConfirmReset(false);
    setTimeout(() => setNotice(null), 5000);
  }

  return (
    <div className="eo-preview eo-shell" data-role={account.role}>
      <aside className={`eo-shell-side${open ? ' is-open' : ''}`} aria-label="Main menu">
        <div className="eo-shell-brandrow">
          <Link href={root} className="eo-brand" data-testid="link-brand" onClick={() => setOpen(false)}>
            <BrandMark size={34} />OpusEvents
          </Link>
          <button className="eo-shell-close" onClick={() => setOpen(false)} aria-label="Close menu"><X size={20} /></button>
        </div>
        <p className="eo-shell-rolechip">{ROLE_NAME[account.role]}</p>

        <nav className="eo-shell-nav">
          {items.map(({ href, label, icon: Icon }) => {
            const active = isActive(location, href, root) || (href === root && isEventPage);
            return (
              <Link key={href} href={href} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)}
                data-testid={`link-nav-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}>
                <Icon size={18} />{label}
              </Link>
            );
          })}
        </nav>

        <div className="eo-shell-user" data-testid="card-account">
          <div className="eo-shell-user-top">
            <span className="eo-shell-avatar" aria-hidden>{initials(account.name)}</span>
            <div>
              <strong data-testid="text-account-name">{account.name}</strong>
              <small>{account.title}</small>
            </div>
          </div>
          <div className="eo-shell-user-actions">
            <button onClick={switchAccount} data-testid="button-switch-account"><ArrowLeftRight size={15} />Switch account</button>
            <button onClick={() => setConfirmReset(true)} data-testid="button-reset-demo"><RotateCcw size={15} />Reset demo</button>
          </div>
        </div>
      </aside>

      <div className="eo-shell-main">
        <header className="eo-shell-mobilebar">
          <button onClick={() => setOpen(true)} aria-label="Open menu" data-testid="button-open-menu"><Menu size={22} /></button>
          <span className="eo-brand eo-shell-mobilebrand"><BrandMark size={28} />OpusEvents</span>
          <span className="eo-shell-avatar small" aria-hidden>{initials(account.name)}</span>
        </header>
        {notice && <div className="eo-notice eo-success eo-shell-notice" role="status" data-testid="text-reset-notice">{notice}</div>}
        <main id="main-content" className="eo-shell-content" key={location}>{children}</main>
      </div>
      {open && <button className="eo-shell-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />}

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the demo?</AlertDialogTitle>
            <AlertDialogDescription>
              All bookings, requests, shifts and leave go back to the starting point for everyone using this demo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Keep my changes</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void reset(); }} disabled={resetting} data-testid="button-confirm-reset">
              {resetting ? 'Resetting…' : 'Reset demo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
