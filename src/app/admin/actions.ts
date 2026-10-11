'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formatRetryAfter } from '../../lib/rate-limit.ts';
import { passwordMatches } from '../../lib/session.ts';
import { adminConfig, endSession, requireAdmin, startSession } from '../../server/auth.ts';
import { clientIp, limits } from '../../server/limits.ts';
import { addNote, changeStatus, setAssignedPlate, setChecklistItem, setPaymentStatus, setShipment, type ActionResult } from '../../server/orders.ts';
import { assignKfzEvent, checkKfzConnection, kfzWebhookUrl, linkKfzOrder } from '../../server/kfz-api.ts';
import { signKfzBody } from '../../lib/kfz-api.ts';

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const cfg = adminConfig();
  if (!cfg.ok) return { error: `Anmeldung nicht konfiguriert: ${cfg.problem}` };
  const ip = await clientIp();
  const l = limits();
  const perIp = l.loginPerIp.check(ip);
  const global = l.loginGlobal.check('alle');
  if (!perIp.allowed || !global.allowed) {
    const wait = Math.max(perIp.retryAfterMs, global.retryAfterMs);
    return { error: `Zu viele Fehlversuche. Bitte in ${formatRetryAfter(wait)} erneut versuchen.` };
  }
  const password = String(form.get('password') ?? '').slice(0, 200);
  if (!passwordMatches(password, cfg.password)) {
    l.loginPerIp.hit(ip);
    l.loginGlobal.hit('alle');
    // Kleine Verzögerung bremst automatisiertes Raten zusätzlich.
    await new Promise((r) => setTimeout(r, 400));
    return { error: 'Passwort ist nicht korrekt.' };
  }
  l.loginPerIp.reset(ip);
  await startSession();
  redirect('/admin');
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect('/admin/login');
}

function orderId(form: FormData): number {
  const id = Number(form.get('id'));
  if (!Number.isInteger(id) || id <= 0) throw new Error('Ungültige Auftrags-ID');
  return id;
}

function back(id: number, result: ActionResult, ok: string): never {
  revalidatePath(`/admin/auftraege/${id}`);
  revalidatePath('/admin');
  const q = result.ok ? `meldung=${encodeURIComponent(ok)}` : `fehler=${encodeURIComponent(result.error)}`;
  redirect(`/admin/auftraege/${id}?${q}`);
}

export async function statusAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = orderId(form);
  const to = String(form.get('to') ?? '');
  const result = changeStatus(id, to, String(form.get('publicMessage') ?? ''), String(form.get('internalMessage') ?? ''));
  back(id, result, 'Status geändert');
}

export async function checklistAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = orderId(form);
  const result = setChecklistItem(id, String(form.get('key') ?? ''), form.get('checked') === '1');
  back(id, result, 'Checkliste aktualisiert');
}

export async function plateAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = orderId(form);
  const result = setAssignedPlate(id, String(form.get('plate') ?? ''));
  back(id, result, 'Kennzeichen gespeichert');
}

export async function noteAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = orderId(form);
  const result = addNote(id, String(form.get('text') ?? ''));
  back(id, result, 'Notiz gespeichert');
}

export async function shipmentAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = orderId(form);
  const result = setShipment(id, String(form.get('carrier') ?? ''), String(form.get('tracking') ?? ''));
  back(id, result, 'Versanddaten gespeichert');
}

export async function paymentAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = orderId(form);
  const result = setPaymentStatus(id, String(form.get('payment') ?? ''), String(form.get('ref') ?? '').trim().slice(0, 80));
  back(id, result, 'Zahlungsstatus gespeichert');
}

/* ---------- kfz-api.de ---------- */

function kfzBack(q: string): never {
  revalidatePath('/admin/kfz-api');
  redirect(`/admin/kfz-api?${q}`);
}

export async function kfzLinkAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = orderId(form);
  const result = linkKfzOrder(id, String(form.get('kfzOrderId') ?? '').slice(0, 80));
  back(id, result, 'Verknüpfung mit kfz-api.de gespeichert');
}

export async function kfzAssignAction(form: FormData): Promise<void> {
  await requireAdmin();
  const result = assignKfzEvent(String(form.get('eventId') ?? '').slice(0, 200), String(form.get('number') ?? '').slice(0, 30));
  kfzBack(result.ok ? `meldung=${encodeURIComponent('Ereignis zugeordnet und verarbeitet')}` : `fehler=${encodeURIComponent(result.error)}`);
}

export async function kfzCheckAction(): Promise<void> {
  await requireAdmin();
  const r = await checkKfzConnection();
  const text = `${r.message}${r.status ? ` (HTTP ${r.status})` : ''}${r.traceId ? ` · Trace-Id ${r.traceId}` : ''}`;
  kfzBack(`${r.ok ? 'meldung' : 'fehler'}=${encodeURIComponent(`Verbindungstest: ${text}`)}`);
}

/**
 * Selbsttest: signierter PING an die eigene öffentliche Webhook-Adresse – prüft DNS, HTTPS, Routing und Schlüssel.
 * Ersetzt nicht den PING aus dem kfz-api.de-Dashboard, zeigt aber, ob der Endpunkt von außen erreichbar antwortet.
 */
export async function kfzSelfTestAction(): Promise<void> {
  await requireAdmin();
  const secret = process.env.KFZ_API_WEBHOOK_SECRET;
  if (!secret) kfzBack(`fehler=${encodeURIComponent('KFZ_API_WEBHOOK_SECRET fehlt')}`);
  const raw = JSON.stringify({ test: 'easykfz24-selbsttest', at: new Date().toISOString() });
  let text: string;
  let ok = false;
  try {
    const res = await fetch(kfzWebhookUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Signature': signKfzBody(raw, secret as string), 'X-Event-Id': `selbsttest-${Date.now()}` },
      body: raw,
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    ok = res.status === 200;
    text = `HTTP ${res.status} von ${kfzWebhookUrl()}`;
  } catch (e) {
    text = `nicht erreichbar (${(e as Error).message})`;
  }
  kfzBack(`${ok ? 'meldung' : 'fehler'}=${encodeURIComponent(`Selbsttest: ${text}`)}`);
}
