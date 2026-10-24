import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Send, Square, RotateCcw } from 'lucide-react';
import { streamAssistant, type ChatMessage } from '@/lib/assistant';
import { PageHead } from '@/components/manager/common';

const STARTERS = [
  'Are we ready for the next peak season?',
  'Which waiting requests should I approve first?',
  'Where are we short of crew in the next two weeks?',
  'Which regular customers have not booked yet?',
];

export default function Assistant() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages]);
  useEffect(() => () => abort.current?.abort(), []);

  async function ask(text: string) {
    const t = text.trim(); if (!t || busy) return;
    const history: ChatMessage[] = [...messages, { role: 'user', content: t }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setInput(''); setError(null); setBusy(true);
    const ctrl = new AbortController(); abort.current = ctrl;
    try {
      await streamAssistant(history, (chunk) => setMessages((m) => {
        const copy = m.slice(); const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, content: last.content + chunk };
        return copy;
      }), ctrl.signal);
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : 'The assistant is unavailable right now.');
    } finally {
      setBusy(false); abort.current = null;
      setMessages((m) => (m.length && m[m.length - 1].role === 'assistant' && !m[m.length - 1].content ? m.slice(0, -1) : m));
    }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(input); };

  return (
    <div className="mg-page">
      <PageHead title="Planning assistant" sub="Ask about bookings, crew and the season ahead."
        action={messages.length > 0 && <button className="eo-btn" onClick={() => { abort.current?.abort(); setMessages([]); setError(null); }} data-testid="button-new-chat"><RotateCcw size={14} />New chat</button>} />
      <div className="mg-chat">
        <div className="mg-chat-log" ref={log} data-testid="list-messages">
          {messages.length === 0 ? (
            <div className="mg-starters">
              {STARTERS.map((s, i) => <button key={s} className="mg-starter" onClick={() => ask(s)} data-testid={`button-starter-${i}`}>{s}</button>)}
            </div>
          ) : messages.map((m, i) => (
            <div key={i} className={`mg-msg ${m.role}`} data-testid={`text-message-${i}`}>
              {m.content || <span className="mg-typing"><i /><i /><i /></span>}
            </div>
          ))}
          {error && <div className="eo-notice eo-error" data-testid="text-assistant-error">{error}</div>}
        </div>
        <form className="mg-chat-form" onSubmit={submit}>
          <textarea rows={1} value={input} placeholder="Type your question…" onChange={(e) => setInput(e.target.value)} maxLength={4000}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(input); } }} data-testid="input-message" />
          {busy
            ? <button type="button" className="eo-btn" onClick={() => abort.current?.abort()} data-testid="button-stop"><Square size={14} />Stop</button>
            : <button type="submit" className="eo-btn eo-btn-primary" disabled={!input.trim()} data-testid="button-send"><Send size={14} />Send</button>}
        </form>
      </div>
    </div>
  );
}
