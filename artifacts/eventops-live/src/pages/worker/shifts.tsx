import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, HandCoins, MapPin, Loader2 } from 'lucide-react';
import { getGetCalendarQueryKey, getGetWorkerHomeQueryKey, useGetWorkerHome, useTakeTask } from '@workspace/api-client-react';
import { day, rm, time12, ROLE_LABEL } from '@/lib/format';
import { Empty, ErrorState, PageHead, Skel, errMsg } from '@/components/people/bits';
import '@/styles/people.css';

export default function WorkerShifts() {
  const home = useGetWorkerHome();
  const take = useTakeTask();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function onTake(id: number) {
    setBusy(id); setMsg(null);
    try {
      const r = await take.mutateAsync({ taskId: id });
      setMsg({ ok: r.ok, text: r.message });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetWorkerHomeQueryKey() }),
        qc.invalidateQueries({ queryKey: [getGetCalendarQueryKey({ from: '', to: '' })[0]] }),
      ]);
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    setBusy(null);
  }

  const tasks = home.data?.open_tasks ?? [];
  return (
    <div className="pp-page">
      <PageHead kicker="Extra pay" title="Open shifts" sub="Take a gap on a job. Paid at 1.5x your normal rate." />
      {msg && <div className={'eo-notice ' + (msg.ok ? 'eo-success' : 'eo-error')} role="status" data-testid="text-take-message">{msg.ok && <CheckCircle2 size={17} />}{msg.text}</div>}
      {home.isLoading ? <Skel rows={3} tall /> : home.isError ? <ErrorState error={home.error} onRetry={() => home.refetch()} /> :
        tasks.length === 0 ? <Empty icon={<HandCoins size={22} />} title="No open shifts right now" text="Check back soon." /> : (
        <div className="pp-shifts pp-rise-2">
          {tasks.map((t) => (
            <article className="pp-shift" key={t.id} data-testid={`card-shift-${t.id}`}>
              <div>
                <span className="pp-chip">{ROLE_LABEL[t.role] ?? t.role}</span>
                <h3 style={{ fontSize: 17, marginTop: 8 }} data-testid={`text-shift-name-${t.id}`}>{t.name}</h3>
              </div>
              <div className="pp-meta" style={{ marginTop: 0 }}>
                <span>{day(t.date)}</span>
                <span><Clock size={13} />{time12(t.start_time)} – {time12(t.end_time)}</span>
                <span><MapPin size={13} />{t.area}</span>
              </div>
              <div className="pp-shift-pay"><strong data-testid={`text-shift-pay-${t.id}`}>{rm(t.pay_rm)}</strong><span>{t.hours} h · 1.5x</span></div>
              {!t.can_take && t.reason && <p className="pp-reason" data-testid={`text-shift-reason-${t.id}`}>{t.reason}</p>}
              <button className="eo-btn eo-btn-primary pp-big" disabled={!t.can_take || busy !== null} onClick={() => onTake(t.id)} data-testid={`button-take-${t.id}`}>
                {busy === t.id ? <><Loader2 size={16} className="animate-spin" />Taking…</> : 'Take this shift'}
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
