// Endpunkte: Kundenverwaltung (CRM).

import { audit } from '../../audit.ts';
import {
  anonymizeCustomer,
  createCustomer,
  CUSTOMER_CATEGORIES,
  deleteContactOrLocation,
  erasureCheck,
  exportCustomer,
  findDuplicates,
  getCustomer,
  listCustomers,
  mergeCustomers,
  saveContact,
  saveLocation,
  saveVehicle,
  updateCustomer,
} from '../customers.ts';
import { exportResponse, fileResponse } from '../export.ts';
import { HttpError, int, ok, optInt, str, type Route } from '../http.ts';

export const customerRoutes: Route[] = [
  {
    method: 'GET',
    path: 'customers',
    perm: 'customers.read',
    handler: async (c) => {
      const p = c.url.searchParams;
      return {
        items: await listCustomers({
          q: str(p.get('q'), 100),
          category: str(p.get('category'), 40) || undefined,
          type: str(p.get('type'), 10) || undefined,
          ownerId: p.get('owner') ? optInt(p.get('owner')) : undefined,
        }),
        categories: CUSTOMER_CATEGORIES.filter(Boolean),
        canWrite: c.can('customers.write'),
      };
    },
  },
  {
    method: 'GET',
    path: 'customers/export',
    perm: 'customers.read',
    handler: async (c) => {
      const rows = await listCustomers({ limit: 2000 });
      await audit(c.audit, 'export.kunden', '', `${rows.length} Zeilen`);
      return exportResponse(
        str(c.url.searchParams.get('format'), 5),
        'kunden',
        'Kunden',
        ['Kundennr.', 'Art', 'Name', 'E-Mail', 'Telefon', 'Straße', 'PLZ', 'Ort', 'Kategorie', 'Aufträge', 'Laufend', 'Fahrzeuge', 'Umsatz (EUR)', 'Offen (EUR)', 'Letzter Auftrag'],
        rows.map((r) => [
          r.number,
          r.type === 'firma' ? 'Firma' : 'Privat',
          r.name,
          r.email,
          r.phone,
          `${r.street} ${r.house_no}`.trim(),
          r.zip,
          r.city,
          r.category,
          r.orders,
          r.open_orders,
          r.vehicles,
          r.revenue_cents / 100,
          r.open_cents / 100,
          r.last_order_at ? r.last_order_at.slice(0, 10) : '',
        ]),
      );
    },
  },
  { method: 'GET', path: 'customers/duplicates', perm: 'customers.read', handler: async () => findDuplicates() },
  {
    method: 'GET',
    path: 'customers/:id',
    perm: 'customers.read',
    handler: async (c) => {
      const r = await getCustomer(int(c.params.id, 'Kunden-ID'));
      if (!r) throw new HttpError(404, 'Kunde nicht gefunden');
      return { ...r, canWrite: c.can('customers.write'), canFinance: c.can('finance.read'), canGdpr: c.can('settings.manage') };
    },
  },
  {
    method: 'POST',
    path: 'customers',
    perm: 'customers.write',
    handler: async (c) => {
      const r = ok(await createCustomer(c.body, c.actor.name));
      await audit(c.audit, 'kunde.angelegt', String(r.id));
      return r;
    },
  },
  {
    method: 'POST',
    path: 'customers/merge',
    perm: 'customers.write',
    handler: async (c) => {
      const target = int(c.body.target, 'Ziel-ID');
      const source = int(c.body.source, 'Quell-ID');
      const r = ok(await mergeCustomers(target, source, c.actor.name));
      await audit(c.audit, 'kunde.zusammengefuehrt', String(target), `aus ${source}`);
      return r;
    },
  },
  {
    method: 'POST',
    path: 'customers/:id',
    perm: 'customers.write',
    handler: async (c) => {
      const id = int(c.params.id, 'Kunden-ID');
      const r = ok(await updateCustomer(id, c.body));
      await audit(c.audit, 'kunde.geaendert', String(id));
      return r;
    },
  },
  {
    method: 'POST',
    path: 'customers/:id/:kind',
    perm: 'customers.write',
    handler: async (c) => {
      const id = int(c.params.id, 'Kunden-ID');
      const sub = c.body.id === undefined || c.body.id === null ? null : int(c.body.id);
      const data = (c.body.data ?? {}) as Record<string, unknown>;
      if (c.body.delete === true && sub && (c.params.kind === 'contacts' || c.params.kind === 'locations')) {
        return ok(await deleteContactOrLocation(c.params.kind === 'contacts' ? 'contact' : 'location', id, sub));
      }
      if (c.params.kind === 'contacts') return ok(await saveContact(id, sub, data));
      if (c.params.kind === 'locations') return ok(await saveLocation(id, sub, data));
      if (c.params.kind === 'vehicles') return ok(await saveVehicle(id, sub, data));
      throw new HttpError(404, 'Unbekannter Bereich');
    },
  },
  {
    method: 'GET',
    path: 'customers/:id/gdpr-export',
    perm: 'customers.read',
    handler: async (c) => {
      const id = int(c.params.id, 'Kunden-ID');
      const data = await exportCustomer(id);
      if (!data) throw new HttpError(404, 'Kunde nicht gefunden');
      await audit(c.audit, 'dsgvo.auskunft', String(id));
      return fileResponse(new TextEncoder().encode(JSON.stringify(data, null, 2)), `dsgvo-auskunft-kunde-${id}.json`, 'application/json; charset=utf-8');
    },
  },
  { method: 'GET', path: 'customers/:id/erasure', perm: 'settings.manage', handler: async (c) => erasureCheck(int(c.params.id, 'Kunden-ID')) },
  {
    method: 'POST',
    path: 'customers/:id/anonymize',
    perm: 'settings.manage',
    handler: async (c) => {
      const id = int(c.params.id, 'Kunden-ID');
      if (str(c.body.confirm, 20) !== 'ANONYMISIEREN') throw new HttpError(400, 'Bitte zur Bestätigung ANONYMISIEREN eingeben');
      const r = ok(await anonymizeCustomer(id, c.actor.name));
      await audit(c.audit, 'dsgvo.anonymisiert', String(id));
      return r;
    },
  },
];
