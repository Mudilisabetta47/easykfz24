// E-Mail-Versand über SMTP. Konfiguration per Umgebung:
//   SMTP_URL   z. B. smtps://benutzer:passwort@smtp.example.de:465 oder smtp://…:587 (STARTTLS)
//   MAIL_FROM  z. B. "EasyKFZ24 <service@easykfz24.de>"
// Ohne Konfiguration wird nichts versendet; die Benachrichtigung wird als „nicht konfiguriert“ protokolliert.

import nodemailer, { type Transporter } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendResult = { state: 'versendet' } | { state: 'nicht_konfiguriert' } | { state: 'fehler'; error: string };

const g = globalThis as unknown as { __ekMailer?: Transporter };

export function mailConfigured(): boolean {
  return !!process.env.SMTP_URL && !!process.env.MAIL_FROM;
}

export async function sendMail(mail: Mail): Promise<SendResult> {
  if (!mailConfigured()) return { state: 'nicht_konfiguriert' };
  try {
    g.__ekMailer ??= nodemailer.createTransport(process.env.SMTP_URL as string, {
      // Keine Dateien oder URLs als Inhalt nachladen – wir senden nur fest aufgebaute Texte.
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    await g.__ekMailer.sendMail({ from: process.env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
    return { state: 'versendet' };
  } catch (e) {
    // Fehlermeldung ohne Zugangsdaten protokollieren
    const msg = (e as Error).message.replace(/\/\/[^@\s]+@/g, '//***@');
    return { state: 'fehler', error: msg.slice(0, 300) };
  }
}
