// Transaktionsmails (Kunde): einheitliches Layout mit Logo, Text- und HTML-Fassung, mobil lesbar (eine Spalte, max. 560 px).
// Inhalte nur aus bestätigten Ereignissen (siehe src/server/transactional-mail.ts). Keine Fahrzeug- oder Ausweisdaten.
//
// RECHTLICH ZU PRÜFEN (vor Freigabe der Kundenmails):
// - Vertragsbestätigung (§ 312f BGB): Umfang der Vertragsinformationen; Widerrufsbelehrung erscheint nur mit WIDERRUF_AKTIV=1
//   (geprüfter Text aus src/lib/withdrawal.ts) – sonst bewusst nicht, statt ungeprüfter Rechtstext.
// - Formulierungen zum vorzeitigen Leistungsbeginn (siehe orderContractInfo).

import { formatEuro } from './format.ts';
import { BRAND_NOTE, PROVIDER, PROVIDER_ADDRESS, PROVIDER_CONTACT, PROVIDER_NAME } from './site.ts';
import { EARLY_START_TEXT, LOSS_ACK_TEXT, VALUE_HINT_TEXT } from './withdrawal.ts';

export const MAIL_KINDS = [
  'bestellung',
  'zahlung_bestaetigt',
  'zahlung_fehlgeschlagen',
  'erstattung',
  'unterlagen_erforderlich',
  'vollmacht_bestaetigt',
  'antrag_eingereicht',
  'zulassung_abgeschlossen',
  'auftrag_abgelehnt',
] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

export const MAIL_KIND_LABEL: Record<MailKind, string> = {
  bestellung: 'Bestell- und Vertragsbestätigung',
  zahlung_bestaetigt: 'Zahlungsbestätigung',
  zahlung_fehlgeschlagen: 'Zahlung fehlgeschlagen',
  erstattung: 'Erstattung',
  unterlagen_erforderlich: 'Unterlagen erforderlich',
  vollmacht_bestaetigt: 'Vollmacht bestätigt',
  antrag_eingereicht: 'Antrag eingereicht',
  zulassung_abgeschlossen: 'Zulassung abgeschlossen',
  auftrag_abgelehnt: 'Auftrag nicht abgeschlossen',
};

export interface Mail {
  subject: string;
  text: string;
  html: string;
}

export interface MailContext {
  /** Basisadresse für Links und Logo, z. B. https://easykfz24.de */
  baseUrl: string;
  number: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const dateDe = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });
};

/** Anbieterangaben (Marke ≠ Rechtsträger) – im Fuß jeder Kundenmail */
export const PROVIDER_LINES = [
  PROVIDER_NAME,
  PROVIDER_ADDRESS,
  PROVIDER_CONTACT,
  `Geschäftsführer: ${PROVIDER.managingDirector} · Sitz: ${PROVIDER.seat}`,
  PROVIDER.register
    ? `${PROVIDER.register.court} ${PROVIDER.register.number}`
    : 'Die Gesellschaft befindet sich in Gründung (noch nicht im Handelsregister eingetragen).',
  BRAND_NOTE,
];

type Block =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string }
  | { kind: 'table'; rows: [string, string][]; total?: [string, string] }
  | { kind: 'small'; text: string };

/** Gemeinsames Layout: Text- und HTML-Fassung aus denselben Bausteinen */
function render(ctx: MailContext, o: { subject: string; preheader: string; title: string; blocks: Block[]; cta?: { label: string; url: string } }): Mail {
  const text: string[] = ['Guten Tag,', '', o.title, ''];
  for (const b of o.blocks) {
    if (b.kind === 'p' || b.kind === 'small') text.push(b.text, '');
    if (b.kind === 'h') text.push(b.text.toUpperCase(), '');
    if (b.kind === 'table') {
      for (const [k, v] of b.rows) text.push(`${k}: ${v}`);
      if (b.total) text.push(`${b.total[0]}: ${b.total[1]}`);
      text.push('');
    }
  }
  if (o.cta) text.push(`${o.cta.label}: ${o.cta.url}`, '');
  text.push(
    'Bei Fragen antworten Sie einfach auf diese E-Mail und nennen Sie Ihre Auftragsnummer.',
    '',
    'Freundliche Grüße',
    'Ihr EasyKFZ24-Team',
    '',
    '–',
    ...PROVIDER_LINES,
  );

  const cell = 'padding-top:14px;font-size:15px;line-height:1.6;color:#0a1433';
  const html = [
    `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.subject)}</title></head>`,
    '<body style="margin:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0a1433">',
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.preheader)}</div>`,
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px"><tr><td align="center">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:28px">',
    `<tr><td><img src="${esc(ctx.baseUrl)}/logo/easykfz24-logo-mail.png" width="200" height="39" alt="EasyKFZ24" style="display:block;border:0;font-size:18px;font-weight:700;color:#0a1433"></td></tr>`,
    `<tr><td style="padding-top:22px;font-size:15px;color:#0a1433">Guten Tag,</td></tr>`,
    `<tr><td style="padding-top:8px;font-size:20px;line-height:1.35;font-weight:700;color:#0a1433">${esc(o.title)}</td></tr>`,
    ...o.blocks.map((b) => {
      if (b.kind === 'p') return `<tr><td style="${cell}">${esc(b.text)}</td></tr>`;
      if (b.kind === 'small') return `<tr><td style="padding-top:12px;font-size:13px;line-height:1.55;color:#5a6683">${esc(b.text)}</td></tr>`;
      if (b.kind === 'h')
        return `<tr><td style="padding-top:22px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:#2a55ff">${esc(b.text)}</td></tr>`;
      const rows = b.rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:7px 0;border-bottom:1px solid #eef1f7;font-size:14px;color:#3b4766">${esc(k)}</td><td align="right" style="padding:7px 0 7px 12px;border-bottom:1px solid #eef1f7;font-size:14px;color:#0a1433;white-space:nowrap">${esc(v)}</td></tr>`,
        )
        .join('');
      const total = b.total
        ? `<tr><td style="padding:10px 0 0;font-size:15px;font-weight:700">${esc(b.total[0])}</td><td align="right" style="padding:10px 0 0 12px;font-size:15px;font-weight:700;white-space:nowrap">${esc(b.total[1])}</td></tr>`
        : '';
      return `<tr><td style="padding-top:10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}${total}</table></td></tr>`;
    }),
    o.cta
      ? `<tr><td style="padding-top:24px"><a href="${esc(o.cta.url)}" style="display:inline-block;background:#2a55ff;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${esc(o.cta.label)}</a></td></tr>`
      : '',
    '<tr><td style="padding-top:24px;font-size:14px;line-height:1.6;color:#3b4766">Bei Fragen antworten Sie einfach auf diese E-Mail und nennen Sie Ihre Auftragsnummer.<br><br>Freundliche Grüße<br>Ihr EasyKFZ24-Team</td></tr>',
    `<tr><td style="padding-top:22px;border-top:1px solid #eef1f7;font-size:12px;line-height:1.6;color:#8a93a8">${PROVIDER_LINES.map(esc).join('<br>')}</td></tr>`,
    '</table></td></tr></table></body></html>',
  ].join('');
  return { subject: o.subject, text: text.join('\n'), html };
}

const statusUrl = (ctx: MailContext) => `${ctx.baseUrl}/status?nr=${encodeURIComponent(ctx.number)}`;

export interface OrderMailData {
  createdAt: string;
  serviceTitle: string;
  lines: { label: string; cents: number }[];
  discountCents: number;
  totalCents: number;
  paymentStatus: 'offen' | 'bezahlt' | 'erstattet';
  /** Zahlungslink mit Zufallstoken (nur wenn Online-Zahlung angeboten wird) */
  payUrl: string | null;
  /** Widerrufsbelehrung (nur geprüfter Text bei WIDERRUF_AKTIV=1) */
  withdrawal: { heading: string; paragraphs: string[] }[] | null;
  formUrl: string | null;
  /** Kunde hat den vorzeitigen Beginn ausdrücklich verlangt (Zeitpunkt) – nur bei aktivem Widerruf */
  earlyStartAt: string | null;
  /** Verbraucher ohne verlangten vorzeitigen Beginn: frühester Bearbeitungsbeginn (nach Ablauf der Widerrufsfrist) */
  serviceStartFrom?: string | null;
  /** Zahlung per Überweisung (Vorkasse): Bankverbindung aus den Unternehmensdaten, Verwendungszweck = Auftragsnummer */
  bankTransfer?: { recipient: string; iban: string; bic: string; bankName: string; reference: string; amountCents: number; dueDate: string } | null;
}

const dayDe = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
};

/** Zahlungsaufforderung per Überweisung als Zeilen (Mail, Status, Bestätigung) */
export function bankTransferRows(b: NonNullable<OrderMailData['bankTransfer']>): [string, string][] {
  return [
    ['Empfänger', b.recipient],
    ['IBAN', b.iban],
    ...(b.bic ? ([['BIC', b.bic]] as [string, string][]) : []),
    ...(b.bankName ? ([['Bank', b.bankName]] as [string, string][]) : []),
    ['Betrag', formatEuro(b.amountCents)],
    ['Verwendungszweck', b.reference],
    ['Zahlbar bis', dayDe(b.dueDate)],
  ];
}

/** Pflichtangaben zum Vertrag (RECHTLICH ZU PRÜFEN) */
export function orderContractInfo(d: OrderMailData): string[] {
  return [
    'Mit dieser Bestellbestätigung nehmen wir Ihren Auftrag an; der Vertrag ist damit geschlossen.',
    `Vertragspartner ist die ${PROVIDER_NAME}, ${PROVIDER_ADDRESS}. ${BRAND_NOTE}`,
    `Leistung: Übernahme des beauftragten Zulassungsvorgangs („${d.serviceTitle}“) gegenüber der zuständigen Zulassungsbehörde im Rahmen der erteilten Vollmacht.`,
    'Preise: Servicepauschale und Zusatzleistungen inkl. gesetzlicher MwSt. Amtliche Gebühren der Zulassungsbehörde sind nicht enthalten und werden ohne Aufschlag nach Beleg weiterberechnet.',
    d.serviceStartFrom
      ? `Da Sie keinen vorzeitigen Beginn verlangt haben, beginnen wir mit der Bearbeitung erst nach Ablauf der Widerrufsfrist, frühestens am ${dateDe(d.serviceStartFrom)}, und sobald Angaben und Unterlagen vollständig vorliegen.`
      : 'Die Bearbeitung beginnt, sobald Angaben und Unterlagen vollständig vorliegen.',
  ];
}

export function orderConfirmationMail(ctx: MailContext, d: OrderMailData): Mail {
  // Rabatte stehen bereits als eigene (negative) Preiszeile in der Aufstellung
  const rows: [string, string][] = d.lines.map((l) => [l.label, formatEuro(l.cents)]);
  const blocks: Block[] = [
    { kind: 'p', text: `vielen Dank für Ihren Auftrag. Hiermit bestätigen wir den Eingang und den Inhalt Ihrer Bestellung vom ${dateDe(d.createdAt)}.` },
    { kind: 'h', text: 'Ihre Bestellung' },
    {
      kind: 'table',
      rows: [
        ['Auftragsnummer', ctx.number],
        ['Bestelldatum', dateDe(d.createdAt)],
        ['Leistung', d.serviceTitle],
      ],
    },
    { kind: 'h', text: 'Preise' },
    { kind: 'table', rows, total: ['Gesamt (inkl. MwSt.)', formatEuro(d.totalCents)] },
    { kind: 'small', text: 'zzgl. amtlicher Gebühren der Zulassungsbehörde (ohne Aufschlag, nach Beleg).' },
    { kind: 'h', text: 'Zahlung' },
    {
      kind: 'p',
      text:
        d.paymentStatus === 'bezahlt'
          ? 'Ihre Zahlung ist bereits bestätigt.'
          : d.payUrl
            ? 'Die Zahlung ist noch offen. Sie können sie über den sicheren Zahlungslink unten abschließen.'
            : d.bankTransfer
              ? 'Bitte überweisen Sie den Gesamtbetrag unter Angabe der Auftragsnummer als Verwendungszweck. Ihre Zahlung gilt als eingegangen, sobald sie auf unserem Konto gutgeschrieben ist; Sie erhalten dann eine Zahlungsbestätigung. Bei der Zulassungsbehörde reichen wir Ihren Vorgang erst nach Zahlungseingang ein.'
              : 'Die Zahlung ist noch offen. Nach Prüfung Ihrer Unterlagen erhalten Sie von uns per E-Mail eine Zahlungsaufforderung mit den Zahlungsdetails. Bei der Zulassungsbehörde reichen wir Ihren Vorgang erst nach Zahlungseingang ein.',
    },
    ...(d.paymentStatus === 'offen' && !d.payUrl && d.bankTransfer ? [{ kind: 'table' as const, rows: bankTransferRows(d.bankTransfer) }] : []),
    { kind: 'h', text: 'Vertragsinformationen' },
    ...orderContractInfo(d).map((t): Block => ({ kind: 'p', text: t })),
  ];
  if (d.withdrawal) {
    blocks.push({ kind: 'h', text: 'Widerrufsbelehrung' });
    for (const s of d.withdrawal) {
      blocks.push({ kind: 'p', text: s.heading });
      for (const p of s.paragraphs) blocks.push({ kind: 'small', text: p });
    }
    if (d.formUrl) blocks.push({ kind: 'small', text: `Muster-Widerrufsformular und Online-Widerruf: ${d.formUrl}` });
  }
  if (d.earlyStartAt) {
    blocks.push({ kind: 'h', text: 'Beginn vor Ablauf der Widerrufsfrist' });
    blocks.push({ kind: 'small', text: `Ihre Erklärungen vom ${dateDe(d.earlyStartAt)}:` });
    blocks.push({ kind: 'small', text: `„${EARLY_START_TEXT}“` });
    blocks.push({ kind: 'small', text: `„${LOSS_ACK_TEXT}“` });
    blocks.push({ kind: 'small', text: `Hinweis zum Wertersatz: ${VALUE_HINT_TEXT}` });
  }
  blocks.push({
    kind: 'small',
    text: `Den aktuellen Bearbeitungsstand sehen Sie jederzeit in der Statusabfrage (Auftragsnummer und E-Mail-Adresse): ${statusUrl(ctx)}`,
  });
  blocks.push({ kind: 'small', text: `Kundeninformationen: ${ctx.baseUrl}/kundeninformationen · Datenschutzerklärung: ${ctx.baseUrl}/datenschutz` });
  return render(ctx, {
    subject: `Auftragsbestätigung ${ctx.number} – EasyKFZ24`,
    preheader: `Ihr Auftrag ${ctx.number} ist bei uns eingegangen.`,
    title: `Ihr Auftrag ${ctx.number} ist eingegangen`,
    blocks,
    cta: d.paymentStatus === 'offen' && d.payUrl ? { label: 'Jetzt sicher bezahlen', url: d.payUrl } : { label: 'Status ansehen', url: statusUrl(ctx) },
  });
}

/** Mollie-Methodenkennung → Bezeichnung für Kunden */
const METHOD_LABEL: Record<string, string> = {
  creditcard: 'Kreditkarte',
  paypal: 'PayPal',
  applepay: 'Apple Pay',
  googlepay: 'Google Pay',
  klarna: 'Klarna',
  klarnapaylater: 'Klarna',
  klarnasliceit: 'Klarna',
  klarnapaynow: 'Klarna',
  banktransfer: 'Überweisung',
  ueberweisung: 'Überweisung',
  directdebit: 'SEPA-Lastschrift',
  paybybank: 'Pay by Bank',
  trustly: 'Trustly',
};
export const methodLabel = (m: string) => METHOD_LABEL[m] ?? m;

export function paymentConfirmedMail(ctx: MailContext, d: { amountCents: number; method: string; paidAt: string }): Mail {
  return render(ctx, {
    subject: `Zahlung bestätigt – Auftrag ${ctx.number}`,
    preheader: `Wir haben Ihre Zahlung über ${formatEuro(d.amountCents)} erhalten.`,
    title: 'Vielen Dank – Ihre Zahlung ist eingegangen',
    blocks: [
      {
        kind: 'table',
        rows: [
          ['Auftragsnummer', ctx.number],
          ['Betrag', formatEuro(d.amountCents)],
          ...(d.method ? ([['Zahlart', methodLabel(d.method)]] as [string, string][]) : []),
          ['Bestätigt am', dateDe(d.paidAt)],
        ],
      },
      { kind: 'small', text: 'Die Zahlung wurde von unserem Zahlungsdienstleister Mollie bestätigt. Diese E-Mail ist keine Rechnung.' },
    ],
    cta: { label: 'Status ansehen', url: statusUrl(ctx) },
  });
}

export function paymentFailedMail(ctx: MailContext, d: { payUrl: string | null }): Mail {
  return render(ctx, {
    subject: `Zahlung nicht abgeschlossen – Auftrag ${ctx.number}`,
    preheader: 'Ihre Zahlung konnte nicht abgeschlossen werden. Es wurde nichts abgebucht.',
    title: 'Ihre Zahlung ist fehlgeschlagen',
    blocks: [
      {
        kind: 'p',
        text: 'Ihre Zahlung konnte nicht abgeschlossen werden. Es wurde nichts abgebucht. Sie können es jederzeit erneut versuchen, gern mit einer anderen Zahlart.',
      },
    ],
    cta: d.payUrl ? { label: 'Erneut bezahlen', url: d.payUrl } : { label: 'Status ansehen', url: statusUrl(ctx) },
  });
}

export function refundMail(ctx: MailContext, d: { amountCents: number; full: boolean }): Mail {
  return render(ctx, {
    subject: `Erstattung zu Auftrag ${ctx.number}`,
    preheader: `Wir haben ${formatEuro(d.amountCents)} erstattet.`,
    title: d.full ? 'Ihre Zahlung wurde vollständig erstattet' : 'Wir haben einen Teilbetrag erstattet',
    blocks: [
      {
        kind: 'table',
        rows: [
          ['Auftragsnummer', ctx.number],
          ['Erstatteter Betrag', formatEuro(d.amountCents)],
        ],
      },
      { kind: 'small', text: 'Die Gutschrift erfolgt über die ursprünglich verwendete Zahlart; je nach Bank kann sie einige Tage dauern.' },
    ],
    cta: { label: 'Status ansehen', url: statusUrl(ctx) },
  });
}

const STATUS_MAILS: Record<
  'unterlagen_erforderlich' | 'vollmacht_bestaetigt' | 'antrag_eingereicht' | 'zulassung_abgeschlossen' | 'auftrag_abgelehnt',
  { subject: string; title: string; text: string }
> = {
  unterlagen_erforderlich: {
    subject: 'Für Ihren Auftrag {nr} fehlen noch Unterlagen',
    title: 'Wir benötigen noch Unterlagen oder Angaben',
    text: 'Für Ihren Auftrag fehlen noch Unterlagen oder Angaben. Was genau fehlt, sehen Sie in der Statusabfrage; wir melden uns zusätzlich mit den Einzelheiten.',
  },
  vollmacht_bestaetigt: {
    subject: 'Ihre Vollmacht ist bestätigt – Auftrag {nr}',
    title: 'Ihre digitale Vollmacht ist unterschrieben',
    text: 'Die Unterschrift Ihrer Vollmacht wurde von unserem Vollmachtspartner bestätigt. Sie müssen hierfür nichts weiter tun.',
  },
  antrag_eingereicht: {
    subject: 'Ihr Antrag ist eingereicht – Auftrag {nr}',
    title: 'Ihr Antrag liegt bei der Zulassungsbehörde',
    text: 'Wir haben Ihren Antrag übermittelt. Er wird jetzt von der Zulassungsbehörde bearbeitet.',
  },
  zulassung_abgeschlossen: {
    subject: 'Ihr Zulassungsvorgang ist abgeschlossen – Auftrag {nr}',
    title: 'Gute Nachricht: Ihr Vorgang ist abgeschlossen',
    text: 'Die Zulassungsbehörde hat Ihren Antrag erfolgreich beschieden. Über Versand bzw. Abholung Ihrer Unterlagen informieren wir Sie gesondert.',
  },
  auftrag_abgelehnt: {
    subject: 'Ihr Auftrag {nr} konnte nicht abgeschlossen werden',
    title: 'Ihr Auftrag konnte leider nicht abgeschlossen werden',
    text: 'Ihr Auftrag konnte nicht wie beauftragt abgeschlossen werden. Wir setzen uns mit Ihnen in Verbindung und besprechen die nächsten Schritte.',
  },
};

export function statusMail(ctx: MailContext, kind: keyof typeof STATUS_MAILS): Mail {
  const m = STATUS_MAILS[kind];
  return render(ctx, {
    subject: m.subject.replace('{nr}', ctx.number),
    preheader: m.title,
    title: m.title,
    blocks: [
      { kind: 'table', rows: [['Auftragsnummer', ctx.number]] },
      { kind: 'p', text: m.text },
      { kind: 'small', text: 'Aus Datenschutzgründen enthält diese E-Mail keine Fahrzeug- oder Halterdaten.' },
    ],
    cta: { label: 'Status ansehen', url: statusUrl(ctx) },
  });
}

/** Beispielinhalte für den kontrollierten Testversand (synthetische Daten, keine Kundendaten) */
export function sampleMail(kind: MailKind, baseUrl: string): Mail {
  const ctx = { baseUrl, number: 'EK-2026-TEST' };
  const sample: OrderMailData = {
    createdAt: new Date().toISOString(),
    serviceTitle: 'Neuzulassung (Beispiel)',
    lines: [
      { label: 'Servicepauschale Neuzulassung', cents: 4999 },
      { label: 'Kennzeichenschilder (2 Stück)', cents: 2598 },
    ],
    discountCents: 0,
    totalCents: 7597,
    paymentStatus: 'offen',
    payUrl: `${baseUrl}/status`,
    withdrawal: null,
    formUrl: null,
    earlyStartAt: null,
  };
  let m: Mail;
  if (kind === 'bestellung') m = orderConfirmationMail(ctx, sample);
  else if (kind === 'zahlung_bestaetigt') m = paymentConfirmedMail(ctx, { amountCents: 7597, method: 'creditcard', paidAt: new Date().toISOString() });
  else if (kind === 'zahlung_fehlgeschlagen') m = paymentFailedMail(ctx, { payUrl: `${baseUrl}/status` });
  else if (kind === 'erstattung') m = refundMail(ctx, { amountCents: 7597, full: true });
  else m = statusMail(ctx, kind);
  return { ...m, subject: `[TEST] ${m.subject}` };
}
