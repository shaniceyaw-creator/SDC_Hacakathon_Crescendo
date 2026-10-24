import { toneFor } from '@/lib/booking-list';

export function TypeBadge({ type }: { type: string }) {
  const t = toneFor(type);
  return <span className="bl-badge" style={{ color: t.fg, background: t.bg }} data-testid="badge-event-type">{type}</span>;
}
