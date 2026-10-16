import { audit } from '../../audit.ts';
import { getCatalog, getRequirements, retrySearch, kennzeichenDetail, importReservation, kennzeichenBudget, KennzeichenError, kennzeichenPolicy, listKennzeichen, prepareReservation, refreshReservation, searchPlate } from '../../kennzeichen.ts';
import { HttpError, str, type Ctx, type Route } from '../http.ts';

function handle(handler: (c: Ctx) => Promise<unknown>) {
  return async (c: Ctx) => {
    try { return await handler(c); } catch (e) {
      if (e instanceof KennzeichenError) {
        if (e.status === 429) return Response.json({ error: e.message }, { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
        throw new HttpError(e.status, e.message);
      }
      throw e;
    }
  };
}
// Same-Origin, Sitzung und Rechte prüft der gemeinsame OS-Router. Kein kostenpflichtiger öffentlicher Endpunkt.
export const kennzeichenRoutes: Route[] = [
  { method: 'GET', path: 'kennzeichen/operations/:id', perm: 'kfz.write', handler: handle(async (c) => {
    c.need('customers.read');
    const r = await kennzeichenDetail(c.params.id);
    await audit(c.audit, 'kennzeichen.details', c.params.id, 'Geschützte Vorgangsdetails geöffnet');
    return r;
  }) },
  { method: 'POST', path: 'kennzeichen/operations/:id/retry', perm: 'kfz.write', handler: handle(async (c) => {
    const r = await retrySearch(c.actor.id, c.params.id);
    await audit(c.audit, 'kennzeichen.wiederholung', c.params.id, 'Identische Kostenreferenz');
    return r;
  }) },
  { method: 'GET', path: 'kennzeichen', perm: 'kfz.read', handler: handle(async (c) => ({ policy: kennzeichenPolicy(), budgetReservedCent: await kennzeichenBudget(), canWrite: c.can('kfz.write'), operations: await listKennzeichen(), catalog: await getCatalog() })) },
  { method: 'POST', path: 'kennzeichen/bezirke', perm: 'kfz.write', handler: handle(async (c) => ({ catalog: await getCatalog(c.actor.id, true) })) },
  { method: 'POST', path: 'kennzeichen/bezirke/:ks/anforderungen', perm: 'kfz.write', handler: handle(async (c) => ({ requirements: await getRequirements(c.params.ks, c.actor.id, true) })) },
  { method: 'POST', path: 'kennzeichen/search', perm: 'kfz.write', handler: handle(async (c) => {
    const r = await searchPlate(c.actor.id, c.body.plate, c.body.reference);
    await audit(c.audit, 'kennzeichen.abfrage', '', 'Abfrage mit Kostenobergrenze');
    return r;
  }) },
  { method: 'POST', path: 'kennzeichen/reservations/prepare', perm: 'kfz.write', handler: handle(async (c) => {
    c.need('customers.write');
    const r = await prepareReservation(c.actor.id, c.body.reservation, c.body.reference);
    await audit(c.audit, 'kennzeichen.entwurf', r.id, 'Keine Reservierung ausgelöst');
    return r;
  }) },
  { method: 'POST', path: 'kennzeichen/reservations/import', perm: 'kfz.write', handler: handle(async (c) => {
    c.need('customers.read');
    const r = await importReservation(c.actor.id, str(c.body.jobId, 121), c.body.reference);
    await audit(c.audit, 'kennzeichen.bestand', r.id, 'Bestehende Reservierung abgerufen');
    return r;
  }) },
  { method: 'POST', path: 'kennzeichen/reservations/:id/refresh', perm: 'kfz.write', handler: handle(async (c) => {
    c.need('customers.read');
    const r = await refreshReservation(c.actor.id, c.params.id);
    await audit(c.audit, 'kennzeichen.status', c.params.id, 'Status/PIN abgerufen');
    return r;
  }) },
];
