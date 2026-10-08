'use server';

import { normalizeOrderNumber } from '../../../lib/order-number.ts';
import { formatRetryAfter } from '../../../lib/rate-limit.ts';
import { checkEmail } from '../../../lib/validation.ts';
import { clientIp, limits } from '../../../server/limits.ts';
import { lookupStatus, type PublicStatus } from '../../../server/orders.ts';

export type StatusState = { result?: PublicStatus; error?: string; nr?: string; email?: string };

export async function lookupAction(_prev: StatusState, form: FormData): Promise<StatusState> {
  const nrRaw = String(form.get('nr') ?? '').slice(0, 40);
  const emailRaw = String(form.get('email') ?? '').slice(0, 200);
  const keep = { nr: nrRaw, email: emailRaw };

  const limit = limits().status.hit(await clientIp());
  if (!limit.allowed) return { ...keep, error: `Zu viele Abfragen. Bitte versuchen Sie es in ${formatRetryAfter(limit.retryAfterMs)} erneut.` };

  const nr = normalizeOrderNumber(nrRaw);
  const email = checkEmail(emailRaw);
  if (!nr || !email.ok) return { ...keep, error: 'Bitte Auftragsnummer (EK-JJJJ-NNNNN) und E-Mail-Adresse prüfen.' };

  const result = lookupStatus(nr, email.value);
  if (!result) return { ...keep, error: 'Zu dieser Kombination aus Auftragsnummer und E-Mail-Adresse wurde kein Auftrag gefunden.' };
  return { ...keep, result };
}
