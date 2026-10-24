import { AlertTriangle } from 'lucide-react';
import type { Estimate, EquipmentLine, RoleStaffing } from '@workspace/api-client-react';
import { rm, rmRange, ROLE_LABEL } from '@/lib/format';
import { Empty } from './common';

export const ROLES = ['Event_Coordinators', 'AV_Technicians', 'Logistics_Crew', 'Safety_Officers'] as const;

export function MoneyRow({ est, price }: { est: Estimate; price?: number }) {
  const p = price ?? est.price_rm;
  const margin = p > 0 ? ((p - est.cost_rm) / p) * 100 : est.margin_pct;
  return (
    <div className="mg-money">
      <div><small>Cost</small><strong data-testid="text-cost">{rm(est.cost_rm)}</strong></div>
      <div><small>Price</small><strong data-testid="text-price">{rm(p)}</strong></div>
      <div><small>Margin</small><strong data-testid="text-margin">{Math.round(margin)}%</strong></div>
      <div><small>Quote range</small><strong data-testid="text-quote" style={{ fontSize: 15 }}>{rmRange(est.quote_low, est.quote_high)}</strong></div>
    </div>
  );
}

export function Warnings({ list }: { list: string[] }) {
  if (!list.length) return null;
  return <ul className="mg-warn" data-testid="list-warnings">{list.map((w, i) => <li key={i}><AlertTriangle size={14} />{w}</li>)}</ul>;
}

export function EquipmentTable({ lines }: { lines: EquipmentLine[] }) {
  const used = lines.filter((l) => l.needed > 0);
  if (!used.length) return <p className="mg-muted">No equipment needed.</p>;
  return (
    <div className="mg-table-wrap">
      <table className="mg-eq" data-testid="table-equipment">
        <thead><tr><th>Item</th><th>Needed</th><th>In store</th><th>To rent</th></tr></thead>
        <tbody>{used.map((l) => (
          <tr key={l.item} data-testid={`row-equipment-${l.item}`}>
            <td>{l.label}</td><td>{l.needed}</td><td>{l.in_store}</td>
            <td>{l.rent > 0 ? <span className="mg-pill amber">{l.rent}</span> : '0'}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export function StaffingList({ roles }: { roles: RoleStaffing[] }) {
  const active = roles.filter((r) => r.needed > 0);
  if (!active.length) return <Empty title="No crew needed" />;
  return (
    <div data-testid="list-staffing">
      {active.map((r) => (
        <div className="mg-role" key={r.role} data-testid={`row-staffing-${r.role}`}>
          <div className="mg-role-head">
            <strong>{r.label || ROLE_LABEL[r.role] || r.role} <span className="mg-muted">· {r.needed} needed</span></strong>
            <div className="eo-inline-actions" style={{ gap: 6 }}>
              {r.short === 0 && <span className="mg-pill">Covered</span>}
              {r.open_shifts > 0 && <span className="mg-pill amber">{r.open_shifts} open shift{r.open_shifts > 1 ? 's' : ''} for staff</span>}
              {r.freelance > 0 && <span className="mg-pill peach">{r.freelance} freelance</span>}
            </div>
          </div>
          {r.staff.length > 0 && (
            <div className="mg-chips">{r.staff.map((s) => <span className="mg-chip" key={s.id}>{s.name}{s.note && <small>{s.note}</small>}</span>)}</div>
          )}
        </div>
      ))}
    </div>
  );
}
