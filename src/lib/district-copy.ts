// Texte für die Ortsseiten /kennzeichen/[kuerzel]. Eigene Formulierungen, je Kürzel deterministisch variiert,
// damit 700+ Seiten nicht wortgleich sind. Keine festen Behördengebühren – die richten sich nach der Gebührenordnung.

import { formatEuro } from './format.ts';
import { BUNDLE_NAMES, PRICE_CONFIG } from './pricing.config.ts';
import { fromPrice, isPromoActive, servicePrice } from './pricing.ts';
import { NEW_CUSTOMER_PROMO } from './pricing.config.ts';
import { districtLabel, inDistrict, joinGerman, variant, type DistrictPage } from './district-pages.ts';

export interface DistrictCopy {
  title: string;
  metaDescription: string;
  lead: string;
  howTitle: string;
  howIntro: string;
  steps: { t: string; d: string }[];
  meaningTitle: string;
  meaning: string[];
  wishTitle: string;
  wish: string[];
  costTitle: string;
  costIntro: string;
  costRows: { label: string; value: string }[];
  costNote: string;
  faq: { q: string; a: string }[];
}

export function districtCopy(p: DistrictPage): DistrictCopy {
  const C = p.code;
  const where = inDistrict(p.district);
  const label = districtLabel(p.district);
  // Für Titel und Beschreibung kurz halten: bei mehreren Kreisen nur den ersten nennen
  const first = p.district.split(/;\s*/)[0];
  const shortLabel = label.length > 48 ? `${first} u. a.` : label;
  const land = joinGerman(p.states);
  const origin = p.origin && p.origin !== label ? p.origin : null;
  const zulassung = servicePrice('neuzulassung');
  const ummeldung = fromPrice(['halterwechsel', 'umzug']);
  const bundle = PRICE_CONFIG.bundleCents.neuzulassung;
  const promo = isPromoActive(NEW_CUSTOMER_PROMO);

  const leads = [
    `Wunschkennzeichen ${C} reservieren lassen, Fahrzeug ${where} zulassen, ummelden oder abmelden – online beauftragt, ohne Termin bei der Zulassungsstelle.`,
    `Dein ${C}-Kennzeichen ohne Wartenummer: Kombination direkt ins Schild tippen, Auftrag online erteilen und Papiere samt Schildern bequem nach Hause bekommen.`,
    `Alles rund um das Kennzeichen ${C}: Bedeutung, Wunschkombination und Zulassung ${where} – mit EasyKFZ24 online erledigt.`,
  ];

  const intros = [
    `Das Unterscheidungszeichen ${C} bekommst du, wenn dein Fahrzeug ${where} zugelassen wird. Entscheidend ist dein Hauptwohnsitz – bei Firmen der Sitz des Unternehmens. Den Gang zur Zulassungsstelle übernehmen wir: Du beauftragst uns online, lädst die Unterlagen hoch und wir kümmern uns mit deiner Vollmacht um den Rest.`,
    `Wer ${where} gemeldet ist, fährt mit ${C} auf dem Kennzeichen. Statt Terminsuche, Wartemarke und Schilderdienst erledigst du bei uns alles in wenigen Minuten online – wir reichen den Vorgang bei der zuständigen Zulassungsbehörde ein und halten dich über die Statusabfrage auf dem Laufenden.`,
    `Für Fahrzeuge mit Halter ${where} vergibt die Zulassungsbehörde das Kürzel ${C}. Du musst dafür nicht selbst hin: Mit EasyKFZ24 beauftragst du Zulassung, Ummeldung oder Abmeldung online und erhältst Papiere und Kennzeichen per Versand – oder holst sie ab.`,
  ];

  const meaningA = [
    `Die ersten ein bis drei Buchstaben auf einem deutschen Kennzeichen heißen Unterscheidungszeichen, im Alltag meist Ortskennzeichen. Sie zeigen, in welchem Zulassungsbezirk ein Fahrzeug angemeldet ist.`,
    `Vor dem Bindestrich steht auf jedem deutschen Kennzeichen das Unterscheidungszeichen – umgangssprachlich das Ortskennzeichen. Es verrät, welcher Zulassungsbezirk das Fahrzeug zugelassen hat.`,
  ];
  const meaningB = origin
    ? `${C} ist von ${origin} abgeleitet und gilt ${where} (${land}).`
    : `${C} gilt ${where} (${land}).`;
  const meaningC =
    p.sameDistrict.length > 0
      ? `Neben ${C} sind für denselben Bezirk auch ${joinGerman(p.sameDistrict)} vergeben. Seit der Kennzeichenliberalisierung können Halter dort zwischen den Kürzeln wählen – sofern die Zulassungsbehörde sie ausgibt.`
      : null;
  const meaningD = `Auf das Ortskennzeichen selbst hast du keinen Einfluss, es ergibt sich aus deinem Wohnort. Frei wählbar ist dagegen, was danach kommt: ein oder zwei Buchstaben und eine Zahl mit bis zu vier Ziffern – insgesamt höchstens acht Zeichen.`;

  const wishA = [
    `Initialen, Geburtsjahr oder die Glückszahl: Mit einem Wunschkennzeichen wird ${C} persönlich. Tipp deine Kombination oben direkt ins Schild. Lässt du Buchstaben oder Zahlen leer, schlagen wir dir passende Kombinationen vor.`,
    `Du hast schon eine Kombination im Kopf? Gib sie oben direkt ins Schild ein – oder tippe nur ${C} und lass dir Vorschläge zeigen. Beliebt sind Initialen mit Geburtsjahr oder Hochzeitsdatum.`,
  ];
  const wishB = `Ob die Kombination frei ist, entscheidet die Zulassungsbehörde. Wir reservieren sie für dich bei der Zulassung ${where}; ist sie bereits vergeben, melden wir uns mit Alternativen.`;
  const wishC = `Nicht jede Kombination ist erlaubt: Buchstabenfolgen wie HJ, KZ, NS, SA und SS werden bundesweit nicht zugeteilt, außerdem dürfen die Zahlen nicht mit einer 0 beginnen. Für Elektrofahrzeuge gibt es zusätzlich das E-Kennzeichen, für Oldtimer ab 30 Jahren das H-Kennzeichen.`;

  return {
    title: `Kennzeichen ${C} – ${shortLabel}: Wunschkennzeichen & Zulassung`,
    metaDescription: `Kennzeichen ${C}${origin ? ` (${origin})` : ''} · ${shortLabel}, ${land}: Wunschkennzeichen eintippen, Zulassung online beauftragen, Schilder per DHL oder UPS.${promo ? ' Neukunden sparen 10 % auf die Servicepauschale.' : ''}`,
    lead: leads[variant(C, 'lead', leads.length)],
    howTitle: `So bekommst du dein ${C}-Kennzeichen`,
    howIntro: intros[variant(C, 'intro', intros.length)],
    steps: [
      { t: 'Kombination wählen', d: `Wunschkennzeichen oben ins Schild tippen – oder nur ${C} eingeben und Vorschläge ansehen.` },
      { t: 'Online beauftragen', d: 'Leistung und Fahrzeug wählen, Daten eingeben, Unterlagen hochladen. Das dauert nur wenige Minuten.' },
      { t: 'Wir erledigen die Zulassung', d: `Wir prüfen alles und reichen den Vorgang bei der Zulassungsbehörde ${where} ein.` },
      { t: 'Papiere & Schilder erhalten', d: 'Per DHL oder UPS mit Sendungsverfolgung – oder du holst sie ab. Den Stand siehst du jederzeit online.' },
    ],
    meaningTitle: `Was bedeutet das Kennzeichen ${C}?`,
    meaning: [meaningA[variant(C, 'meaning', meaningA.length)], meaningB, ...(meaningC ? [meaningC] : []), meaningD],
    wishTitle: `Wunschkennzeichen ${C} reservieren`,
    wish: [wishA[variant(C, 'wish', wishA.length)], wishB, wishC],
    costTitle: `Was kostet ein ${C}-Kennzeichen bei EasyKFZ24?`,
    costIntro: `Du zahlst bei uns eine feste Servicepauschale je Vorgang, Extras wählst du selbst dazu.${promo ? ' Neukunden erhalten mindestens 10 % Rabatt auf die Servicepauschale – die Servicepauschalen unten sind bereits reduziert.' : ''}`,
    costRows: [
      { label: 'Zulassung (Servicepauschale)', value: `ab ${formatEuro(zulassung.promoCents)}` },
      { label: 'Ummeldung (Servicepauschale)', value: `ab ${formatEuro(ummeldung.promoCents)}` },
      { label: 'Wunschkennzeichen reservieren', value: `+ ${formatEuro(PRICE_CONFIG.wishPlateHandlingCents)}` },
      { label: 'Geprägte Kennzeichenschilder', value: `je ${formatEuro(PRICE_CONFIG.plateSignCents)}` },
      { label: 'Versand mit DHL oder UPS', value: formatEuro(PRICE_CONFIG.shippingCents) },
      ...(bundle !== null ? [{ label: `${BUNDLE_NAMES.neuzulassung}: Zulassung, Wunschkennzeichen, Schilder, Versand`, value: formatEuro(bundle) }] : []),
    ],
    costNote: `Hinzu kommen die amtlichen Gebühren der Zulassungsbehörde ${where}. Sie richten sich nach der Gebührenordnung, hängen vom Vorgang ab und werden getrennt nach Beleg abgerechnet.`,
    faq: [
      {
        q: `Wo wird ein Fahrzeug mit ${C}-Kennzeichen zugelassen?`,
        a: `Zuständig ist die Zulassungsbehörde ${where}. Mit EasyKFZ24 musst du nicht selbst hin: Du erteilst uns online den Auftrag und eine Vollmacht, wir übernehmen den Behördengang.`,
      },
      {
        q: `Kann ich mein ${C}-Kennzeichen bei einem Umzug behalten?`,
        a: `Ja. Ziehst du innerhalb Deutschlands um, darfst du dein bisheriges Kennzeichen behalten – auch wenn dein neuer Wohnort ein anderes Kürzel hat. Die Adressänderung muss trotzdem bei der Zulassungsbehörde eingetragen werden; das erledigen wir als Ummeldung bei Umzug.`,
      },
      {
        q: `Welche Unterlagen brauche ich für die Zulassung ${where}?`,
        a: `In der Regel Personalausweis oder Reisepass mit Meldebescheinigung, die Zulassungsbescheinigung Teil II (bei Neufahrzeugen das COC-Papier), die eVB-Nummer deiner Versicherung und ein SEPA-Mandat für die Kfz-Steuer. Was genau nötig ist, zeigt dir der Auftrag Schritt für Schritt.`,
      },
      {
        q: `Bekomme ich die Kennzeichenschilder für ${C} auch bei euch?`,
        a: `Ja. Wir liefern geprägte Schilder passend zu deinem Fahrzeug – einzeilig fürs Auto, zweizeilig für Motorrad, Leichtkraftrad oder Traktor – per DHL oder UPS. Du kannst aber auch eigene Schilder verwenden.`,
      },
    ],
  };
}
