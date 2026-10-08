import { notFound } from 'next/navigation';
import { OrderFacts } from '../../../../../components/admin/OrderFacts.tsx';
import { LogoMark } from '../../../../../components/Logo.tsx';
import { PrintButton } from '../../../../../components/PrintButton.tsx';
import { formatDateTime } from '../../../../../lib/format.ts';
import { DOCUMENTS, SERVICES } from '../../../../../lib/services.ts';
import { statusLabel } from '../../../../../lib/status.ts';
import { requireAdmin } from '../../../../../server/auth.ts';
import { getOrder, listDocuments } from '../../../../../server/orders.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Druckansicht' };

export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = Number((await params).id);
  const order = Number.isInteger(id) ? getOrder(id) : null;
  if (!order) notFound();
  const docs = listDocuments(id);

  return (
    <main className="print-sheet">
      <div className="no-print print-sheet__bar">
        <PrintButton label="Drucken" />
      </div>
      <header className="print-sheet__head">
        <LogoMark />
        <div>
          <h1>Auftrag {order.number}</h1>
          <p>
            {SERVICES[order.service].title} · Status: {statusLabel(order.status, order.service)} · Eingang {formatDateTime(order.created_at)}
          </p>
          {order.assigned_plate ? <p>Zugeteiltes Kennzeichen: {order.assigned_plate}</p> : null}
        </div>
      </header>
      <OrderFacts order={order} />
      <section className="facts">
        <h2>Unterlagen-Checkliste</h2>
        <ul className="print-check">
          {order.checklistItems.map((i) => (
            <li key={i.key}>
              <span className="print-check__box">{order.checklist[i.key]?.checked ? 'X' : ''}</span>
              {i.label}
              {!i.required ? ' (optional)' : ''}
            </li>
          ))}
        </ul>
      </section>
      <section className="facts">
        <h2>Hochgeladene Dokumente</h2>
        <ul>
          {docs.map((d) => (
            <li key={d.id}>
              {DOCUMENTS[d.kind]?.short ?? d.kind}: {d.original_name}
            </li>
          ))}
        </ul>
      </section>
      <p className="print-sheet__foot">Erstellt {formatDateTime(new Date().toISOString())} · vertraulich</p>
    </main>
  );
}
