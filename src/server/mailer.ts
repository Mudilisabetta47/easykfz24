// E-Mail-Versand. Zwei Wege:
//   1. HTTP-API von Resend (funktioniert auch auf Cloudflare Workers):
//        RESEND_API_KEY  API-Schlüssel (resend.com → API Keys), Absender-Domain dort verifizieren
//   2. SMTP (nur auf einem Node-Server, nicht auf Cloudflare Workers – dort sind keine SMTP-Verbindungen möglich):
//        SMTP_URL        z. B. smtps://benutzer:passwort@smtp.example.de:465
//   In beiden Fällen: MAIL_FROM, z. B. "EasyKFZ24 <service@easykfz24.de>"
// Ohne Konfiguration wird nichts versendet; die Benachrichtigung wird als „nicht konfiguriert“ protokolliert.

import { platform } from './db.ts';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  /** ohne Angabe: der Text, sicher maskiert, mit Zeilenumbrüchen */
  html?: string;
  replyTo?: string;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
export const textToHtml = (t: string) =>
  `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#0f172a">${escapeHtml(t).replace(/\n/g, '<br>')}</div>`;

/** id: Nachweis des Anbieters (Resend-E-Mail-ID bzw. SMTP-Message-ID) – im Resend-Dashboard nachschlagbar */
export type SendResult = { state: 'versendet'; id?: string } | { state: 'nicht_konfiguriert' } | { state: 'fehler'; error: string };

type Transport = { sendMail(m: Record<string, unknown>): Promise<unknown> };
const g = globalThis as unknown as { __ekMailer?: Transport };

function mode(): 'resend' | 'smtp' | null {
  if (!process.env.MAIL_FROM) return null;
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_URL && platform() === 'node') return 'smtp';
  return null;
}

export function mailConfigured(): boolean {
  return mode() !== null;
}

/** Fehlermeldungen ohne Zugangsdaten protokollieren. */
const clean = (msg: string) => msg.replace(/\/\/[^@\s]+@/g, '//***@').replace(/re_[A-Za-z0-9_]{8,}/g, 're_***').slice(0, 300);

export async function sendMail(mail: Mail): Promise<SendResult> {
  const m = mode();
  if (!m) return { state: 'nicht_konfiguriert' };
  try {
    if (m === 'resend') {
      // RESEND_API_BASE nur für Tests (lokaler Nachbau); Vorgabe https://api.resend.com
      const res = await fetch(`${(process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/$/, '')}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.MAIL_FROM,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          html: mail.html ?? textToHtml(mail.text),
          ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { state: 'fehler', error: clean(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`) };
      const j = (await res.json().catch(() => ({}))) as { id?: unknown };
      return { state: 'versendet', ...(typeof j.id === 'string' ? { id: j.id.slice(0, 100) } : {}) };
    }
    if (!g.__ekMailer) {
      // Erst bei Bedarf laden – nodemailer braucht TCP-Verbindungen (nur Node-Server).
      const nodemailer = (await import('nodemailer')).default;
      g.__ekMailer = nodemailer.createTransport(process.env.SMTP_URL as string, { disableFileAccess: true, disableUrlAccess: true });
    }
    const info = (await g.__ekMailer.sendMail({
      from: process.env.MAIL_FROM,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html ?? textToHtml(mail.text),
      ...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
    })) as { messageId?: string } | undefined;
    return { state: 'versendet', ...(info?.messageId ? { id: String(info.messageId).slice(0, 100) } : {}) };
  } catch (e) {
    return { state: 'fehler', error: clean((e as Error).message) };
  }
}
