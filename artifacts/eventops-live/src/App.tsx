import { type ComponentType, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setBaseUrl, type Account } from '@workspace/api-client-react';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { AppShell } from '@/components/shell/app-shell';
import { AuthProvider, homeFor, useAuth } from '@/lib/auth';
import SignIn from '@/pages/sign-in';
import ManagerDashboard from '@/pages/manager/dashboard';
import ManagerNewEvent from '@/pages/manager/new-event';
import ManagerEvent from '@/pages/manager/event';
import ManagerCalendar from '@/pages/manager/calendar';
import ManagerInsights from '@/pages/manager/insights';
import ManagerTeam from '@/pages/manager/team';
import ManagerAssistant from '@/pages/manager/assistant';
import WorkerHome from '@/pages/worker/home';
import WorkerShifts from '@/pages/worker/shifts';
import WorkerCalendar from '@/pages/worker/calendar';
import CustomerHome from '@/pages/customer/home';
import CustomerOrganise from '@/pages/customer/organise';
import CustomerEvents from '@/pages/customer/events';
import About from '@/pages/about';
import BookingsList from '@/pages/bookings/list';
import BookingDetail from '@/pages/bookings/detail';
import NotFound from '@/pages/not-found';
import './eventops.css';

setBaseUrl(import.meta.env.BASE_URL);

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1 }, mutations: { retry: false } },
});

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

const ROUTES: Record<Account['role'], [string, ComponentType][]> = {
  manager: [
    ['/manager', ManagerDashboard], ['/manager/new', ManagerNewEvent], ['/manager/calendar', ManagerCalendar],
    ['/manager/insights', ManagerInsights], ['/manager/team', ManagerTeam], ['/manager/assistant', ManagerAssistant],
    ['/manager/bookings', () => <BookingsList base="manager" />], ['/manager/about', About],
  ],
  worker: [['/worker', WorkerHome], ['/worker/shifts', WorkerShifts], ['/worker/calendar', WorkerCalendar],
    ['/worker/bookings', () => <BookingsList base="worker" />], ['/worker/about', About]],
  customer: [['/customer', CustomerHome], ['/customer/organise', CustomerOrganise], ['/customer/events', CustomerEvents], ['/customer/about', About]],
};

function Routes() {
  const { account, loading } = useAuth();
  const [location] = useLocation();
  if (loading) return <div className="eo-boot" aria-busy="true">Loading…</div>;
  if (!account) {
    return location === '/sign-in' ? <SignIn /> : <Redirect to="/sign-in" replace />;
  }
  const home = homeFor(account.role);
  // Pages for other roles send the user back to their own home.
  if (location === '/' || location === '/sign-in' || !location.startsWith(home)) {
    return <Redirect to={home} replace />;
  }
  return (
    <AppShell account={account}>
      <RoutedErrorBoundary>
        <Switch>
          {ROUTES[account.role].map(([path, Page]) => <Route key={path} path={path} component={Page} />)}
          {account.role === 'manager' && (
            <Route path="/manager/events/:id">{(params) => <ManagerEvent key={params.id} eventId={params.id} />}</Route>
          )}
          {account.role !== 'customer' && (
            <Route path={`/${account.role}/bookings/:eventId`}>{(params) => <BookingDetail key={params.eventId} base={account.role as 'manager' | 'worker'} eventId={params.eventId} />}</Route>
          )}
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Routes />
        </WouterRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
