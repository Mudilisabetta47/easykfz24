import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import { companyWarnings, companySchema, invoiceReadiness } from '../src/server/os/company.ts';
import { BRAND, BRAND_NOTE, imprintGaps, PROVIDER, PROVIDER_CONTACT, PROVIDER_NAME, SITE, telHref } from '../src/lib/site.ts';
import { buildStatusMail } from '../src/lib/notification-mail.ts';
import { DISPLAY, type DisplayStatus } from '../src/lib/kfz-status.ts';

const read = (p: string) => fs.readFileSync(p, 'utf8');
// Öffentliche Seiten und Vorlagen mit Anbieterangaben
const PUBLIC_FILES = [
  'src/app/(site)/impressum/page.tsx',
  'src/app/(site)/datenschutz/page.tsx',
  'src/app/(site)/kfz-anmelden/vollmacht/page.tsx',
  'src/app/(site)/kfz-anmelden/auftrag/bestaetigung/page.tsx',
  'src/components/SiteFooter.tsx',
  'src/components/order/OrderWizard.tsx',
  'src/lib/notification-mail.ts',
];

describe('Impressum und Anbieterangaben: Marke EasyKFZ24, Anbieter MONVEX', () => {
  it('Firma ohne nachgewiesene Eintragung mit „i. G.“ und ohne Registernummer', () => {
    assert.equal(PROVIDER.firm, 'MONVEX UG (haftungsbeschränkt)');
    if (!PROVIDER.register) assert.equal(PROVIDER_NAME, 'MONVEX UG (haftungsbeschränkt) i. G.');
    else assert.match(PROVIDER.register.number, /^HRB \d+( HB)?$/);
    assert.equal(BRAND_NOTE, PROVIDER.register ? `${BRAND} ist eine Marke der ${PROVIDER_NAME}.` : `${BRAND} ist eine Marke der ${PROVIDER_NAME}`);
    assert.ok(!BRAND_NOTE.endsWith('..'), 'kein doppelter Punkt nach „i. G.“');
    assert.equal(SITE.company, PROVIDER_NAME, 'die Website nennt überall dieselbe Firma');
  });

  it('keine fremden oder erfundenen Registerdaten (HRB 222247 gehört zur Metropol Tours GmbH)', () => {
    const all = [read('src/lib/site.ts'), ...PUBLIC_FILES.map(read)].join('\n');
    assert.ok(!/222247|Metropol/i.test(all));
    assert.ok(!/EasyKFZ24 (GmbH|UG|e\. ?K\.|AG)\b/.test(all), 'EasyKFZ24 nie als Gesellschaft');
    assert.ok(!/bevollmächtige EasyKFZ24|EasyKFZ24 übermittelt/.test(all), 'Vollmacht und Mandat an die Gesellschaft, nicht an die Marke');
  });

  it('keine Platzhalter im Impressum, Footer, Vollmacht und Bestellprozess; keine veralteten Rechtsverweise', () => {
    for (const f of PUBLIC_FILES.filter((f) => !f.includes('datenschutz'))) assert.ok(!read(f).includes('PLATZHALTER'), `${f} ohne Platzhalter`);
    for (const v of [SITE.company, SITE.owner, SITE.street, SITE.city, SITE.email]) assert.ok(!v.includes('PLATZHALTER'));
    const imp = read('src/app/(site)/impressum/page.tsx');
    assert.match(imp, /§ 5 DDG/);
    assert.ok(!/§ ?5 TMG|Telemediengesetz/.test(imp));
    // Die EU-OS-Plattform wurde am 20.07.2025 eingestellt – kein Link mehr
    for (const f of PUBLIC_FILES) assert.ok(!/ec\.europa\.eu\/consumers\/odr/.test(read(f)), `${f} ohne OS-Plattform-Link`);
  });

  it('Vertragspartner im Bestellprozess = Anbieter im Impressum; Kundenmails tragen die Anbieterangaben', () => {
    const wizard = read('src/components/order/OrderWizard.tsx');
    assert.match(wizard, /Ihr Vertragspartner: <strong>\{PROVIDER_NAME\}<\/strong>/);
    const display = Object.keys(DISPLAY)[0] as DisplayStatus;
    const mail = buildStatusMail({ number: 'EK-2026-00001', display, statusUrl: 'https://easykfz24.de/status' });
    assert.ok(mail.text.includes(BRAND_NOTE));
    assert.ok(mail.html.includes(PROVIDER_NAME));
  });

  it('OS: abweichender Firmenname wird angezeigt, sperrt aber keine Rechnung', () => {
    const c = companySchema.parse({ name: 'Easykfz24.de eine Marke der MONVEX UG (Haftungsbeschränkt)', street: 'Kirchbachstraße 200', zip: '28211', city: 'Bremen', taxNumber: '1' });
    assert.equal(companyWarnings(c).length, 1);
    assert.deepEqual(invoiceReadiness(c), []);
    assert.deepEqual(companyWarnings({ ...c, name: PROVIDER_NAME }), []);
  });

  it('bestätigte Angaben (13.10.2026): Anschrift, Geschäftsführer, Telefon, E-Mail; weiterhin ohne Registernummer', () => {
    assert.deepEqual([PROVIDER.street, PROVIDER.zip, PROVIDER.city], ['Kirchbachstraße 200', '28211', 'Bremen']);
    assert.equal(PROVIDER.managingDirector, 'Mohammed Al Bakhit');
    assert.equal(PROVIDER.phone, '0421 499 58 207');
    assert.equal(telHref(PROVIDER.phone!), 'tel:+4942149958207');
    assert.equal(PROVIDER.email, 'kundenservice@easykfz24.de');
    assert.equal(PROVIDER.register, null);
    assert.equal(PROVIDER_NAME, 'MONVEX UG (haftungsbeschränkt) i. G.');
    assert.deepEqual(imprintGaps(), []);
  });

  it('Checkout: Telefon und E-Mail des Vertragspartners vor dem Absenden; Bestellbutton nennt die Zahlungspflicht (§ 312j BGB)', () => {
    const wizard = read('src/components/order/OrderWizard.tsx');
    assert.match(wizard, /\{PROVIDER_ADDRESS\}, \{PROVIDER_CONTACT\}/);
    assert.match(wizard, /'Zahlungspflichtig beauftragen'/);
    assert.ok(!wizard.includes('verbindlich absenden'));
    assert.match(PROVIDER_CONTACT, /Telefon 0421 499 58 207 · E-Mail kundenservice@easykfz24\.de/);
  });

  it('fehlende Pflichtangaben werden benannt statt erfunden', () => {
    if (!PROVIDER.phone) assert.ok(imprintGaps().some((g) => g.startsWith('Telefonnummer')));
    else assert.deepEqual(imprintGaps(), []);
  });
});
