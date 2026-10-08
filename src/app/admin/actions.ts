'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formatRetryAfter } from '../../lib/rate-limit.ts';
import { passwordMatches } from '../../lib/session.ts';
import { adminConfig, endSession, requireAdmin, startSession } from '../../server/auth.ts';
import { clientIp, limits } from '../../server/limits.ts';
import { addNote, changeStatus, setAssignedPlate, setChecklistItem, setPaymentStatus, setShipment, type ActionResult } from '../../server/orders.ts';

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
