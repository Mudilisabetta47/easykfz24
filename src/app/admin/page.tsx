import Link from 'next/link';
import { AdminBar } from '../../components/admin/AdminBar.tsx';
import { StatusBadge } from '../../components/admin/StatusBadge.tsx';
import { formatDateTime, formatEuro } from '../../lib/format.ts';
import { SERVICES } from '../../lib/services.ts';
import { STATUS_IDS, STATUSES } from '../../lib/status.ts';
import { maskIban } from '../../lib/validation.ts';
import { PAYMENT_STATUS_LABEL } from '../../lib/payment.ts';
import { requireAdmin } from '../../server/auth.ts';
import { getStats, listOrders } from '../../server/orders.ts';

export const metadata = { title: 'Aufträge' };
export const dynamic = 'force-dynamic';

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  await requireAdmin();
  const { q = '', status = 'offen' } = await searchParams;
  const stats = getStats();
  const orders = listOrders({ q: q.slice(0, 100), status });

  const kpis = [
    { label: 'Offen gesamt', value: stats.open, href: '/admin?status=offen' },
    { label: 'Neu', value: stats.byStatus.neu, href: '/admin?status=neu' },
    { label: 'Unterlagen fehlen', value: stats.byStatus.unterlagen_fehlen, href: '/admin?status=unterlagen_fehlen' },
    { label: 'Bei Zulassungsstelle', value: stats.byStatus.bei_zulassungsstelle, href: '/admin?status=bei_zulassungsstelle' },
    { label: 'Eingang letzte 7 Tage', value: stats.last7Days, href: '/admin?status=alle' },
    { label: 'Abgeschlossen', value: stats.byStatus.abgeschlossen, href: '/admin?status=abgeschlossen' },
  ];

  return (
    <>
      <AdminBar />
      <main className="admin-shell admin-main">
        <h1 className="admin-h1">Aufträge</h1>
        <ul className="kpis" role="list">
          {kpis.map((k) => (
            <li key={k.label}>
              <Link href={k.href} className="kpi card">
                <span className="kpi__value">{k.value}</span>
                <span className="kpi__label">{k.label}</span>
              </Link>
            </li>
          ))}
        </ul>

        <form className="filters card" role="search">
          <div className="field">
            <label htmlFor="q" className="field__label">
              Suche
            </label>
            <input id="q" name="q" type="search" defaultValue={q} placeholder="Auftragsnummer, Name, E-Mail, FIN, Kennzeichen" />
          </div>
          <div className="field">
            <label htmlFor="status" className="field__label">
              Status
            </label>
            <select id="status" name="status" defaultValue={status}>
              <option value="offen">Alle offenen</option>
              <option value="alle">Alle</option>
              {STATUS_IDS.map((s) => (
                <option key={s} value={s}>
                  {STATUSES[s].label} ({stats.byStatus[s]})
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn">
            Filtern
          </button>
        </form>

        <div className="card table-wrap">
          <table className="table">
            <caption className="sr-only">Auftragsliste</caption>
            <thead>
              <tr>
                <th scope="col">Auftrag</th>
                <th scope="col">Eingang</th>
                <th scope="col">Leistung</th>
                <th scope="col">Halter</th>
                <th scope="col">FIN / Kennzeichen</th>
                <th scope="col">IBAN</th>
                <th scope="col">Status</th>
                <th scope="col">Zahlung</th>
                <th scope="col" className="num">
                  Service
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={9} className="table__empty">
                    Keine Aufträge für diese Auswahl.
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/admin/auftraege/${o.id}`} className="table__link">
                        {o.number}
                      </Link>
                    </td>
                    <td>{formatDateTime(o.created_at)}</td>
                    <td>{SERVICES[o.service].title}</td>
                    <td>
                      {o.holder_name}
                      <span className="table__sub">{o.email}</span>
                    </td>
                    <td className="mono">
                      {o.fin}
                      <span className="table__sub">{o.assigned_plate || o.previous_plate || '–'}</span>
                    </td>
                    <td className="mono">{o.iban ? maskIban(o.iban) : '–'}</td>
                    <td>
                      <StatusBadge status={o.status} service={o.service} />
                    </td>
                    <td>
                      <span className={`badge badge--${o.payment_status === 'bezahlt' ? 'green' : o.payment_status === 'erstattet' ? 'slate' : 'amber'}`}>
                        {PAYMENT_STATUS_LABEL[o.payment_status]}
                      </span>
                    </td>
                    <td className="num">{formatEuro(o.total_cents)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
