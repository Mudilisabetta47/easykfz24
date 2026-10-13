// Kunden-E-Mails bei Statusänderungen. Bewusst sparsam: Auftragsnummer, neuer Stand, Link zur Statusabfrage –
// keine Fahrzeug-, Halter- oder Kennzeichendaten (die sieht der Kunde nach Anmeldung in der Statusabfrage).

import { DISPLAY, type DisplayStatus } from './kfz-status.ts';
import { BRAND_NOTE, PROVIDER, PROVIDER_ADDRESS, PROVIDER_CONTACT } from './site.ts';

/** Logo als gehostetes PNG (E-Mail-Programme zeigen kein SVG); ohne Bilder erscheint der Alternativtext „EasyKFZ24“ */
function logoUrl(statusUrl: string): string {
  let origin = 'https://easykfz24.de';
  try {
    origin = new URL(statusUrl).origin;
  } catch {
    /* Standardadresse */
  }
  return `${origin}/logo/easykfz24-logo-mail.png`;
}

/** Anbieterangaben im Fuß jeder Kundenmail: Marke und rechtlicher Anbieter getrennt */
const LEGAL_LINE = `${BRAND_NOTE} ${PROVIDER_ADDRESS} · ${PROVIDER_CONTACT} · Geschäftsführer: ${PROVIDER.managingDirector} · Sitz: ${PROVIDER.seat}${PROVIDER.register ? ` · ${PROVIDER.register.court} ${PROVIDER.register.number}` : ''}`;

export interface StatusMail {
  subject: string;
  text: string;
  html: string;
}

const LEADS: Record<DisplayStatus, string> = {
  eingegangen: 'Ihr Auftrag ist bei uns eingegangen.',
  in_bearbeitung: 'Ihr Antrag wurde übermittelt und wird jetzt von der Zulassungsbehörde bearbeitet.',
  angaben_erforderlich:
    'Für Ihren Antrag sind weitere Angaben oder eine Korrektur erforderlich. Wir prüfen den Hinweis der Behörde und melden uns kurzfristig mit den nächsten Schritten bei Ihnen.',
  abgeschlossen: 'Gute Nachricht: Die Zulassungsbehörde hat Ihren Antrag erfolgreich beschieden. Über Versand bzw. Abholung Ihrer Unterlagen informieren wir Sie gesondert.',
  fehlgeschlagen:
    'Ihr Antrag konnte leider nicht abgeschlossen werden. Wir prüfen den Vorgang und setzen uns mit Ihnen in Verbindung. Sie müssen derzeit nichts weiter tun.',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export function buildStatusMail(input: { number: string; display: DisplayStatus; statusUrl: string }): StatusMail {
  const label = DISPLAY[input.display].label;
  const subject = `Ihr Auftrag ${input.number}: ${label}`;
  const lead = LEADS[input.display];
  const text = [
    'Guten Tag,',
    '',
    `es gibt Neuigkeiten zu Ihrem Auftrag ${input.number}.`,
    '',
    `Aktueller Stand: ${label}`,
    lead,
    '',
    'Den vollständigen Bearbeitungsstand sehen Sie jederzeit in der Statusabfrage (Auftragsnummer und E-Mail-Adresse):',
    input.statusUrl,
    '',
    'Bei Fragen antworten Sie einfach auf diese E-Mail und nennen Sie Ihre Auftragsnummer.',
    '',
    'Freundliche Grüße',
    'Ihr EasyKFZ24-Team',
    '',
    '–',
    'Diese Nachricht wurde automatisch erstellt. Aus Datenschutzgründen enthält sie keine Fahrzeug- oder Halterdaten.',
    LEGAL_LINE,
  ].join('\n');
  const html = `<!doctype html><html lang="de"><body style="margin:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a1433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:28px">
<tr><td><img src="${esc(logoUrl(input.statusUrl))}" width="220" height="43" alt="EasyKFZ24" style="display:block;border:0;font-size:18px;font-weight:700;color:#0a1433"></td></tr>
<tr><td style="padding-top:20px;font-size:15px;line-height:1.6">Guten Tag,<br>es gibt Neuigkeiten zu Ihrem Auftrag <strong>${esc(input.number)}</strong>.</td></tr>
<tr><td style="padding-top:16px"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:#eef3ff;color:#1d3fd1;font-weight:600;font-size:14px">${esc(label)}</span></td></tr>
<tr><td style="padding-top:14px;font-size:15px;line-height:1.6">${esc(lead)}</td></tr>
<tr><td style="padding-top:22px"><a href="${esc(input.statusUrl)}" style="display:inline-block;background:#2a55ff;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Status ansehen</a></td></tr>
<tr><td style="padding-top:22px;font-size:13px;line-height:1.6;color:#5a6683">Bei Fragen antworten Sie einfach auf diese E-Mail und nennen Sie Ihre Auftragsnummer.<br><br>Freundliche Grüße<br>Ihr EasyKFZ24-Team</td></tr>
<tr><td style="padding-top:18px;font-size:12px;color:#8a93a8">Diese Nachricht wurde automatisch erstellt. Aus Datenschutzgründen enthält sie keine Fahrzeug- oder Halterdaten.</td></tr>
<tr><td style="padding-top:10px;font-size:12px;color:#8a93a8">${esc(LEGAL_LINE)}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
