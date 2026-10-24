// Streams the planning assistant's reply (server-sent events from POST /manager/assistant).

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export async function streamAssistant(
  messages: ChatMessage[],
  onText: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/manager/assistant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: messages.slice(-20) }),
    credentials: 'same-origin',
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? 'The assistant is unavailable right now.');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const event of events) {
      const line = event.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const data = JSON.parse(line.slice(6)) as { content?: string; done?: boolean; error?: string };
      if (data.error) throw new Error(data.error);
      if (data.content) onText(data.content);
    }
  }
}
