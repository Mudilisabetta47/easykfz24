// Leistungsseiten für die Suche (z. B. „Auto online abmelden“): je Seite eigener Titel, eigene Beschreibung, eigene FAQ.
// Unterlagen, Originale und Preise kommen aus services.ts bzw. pricing.config.ts – keine abweichenden Angaben.
// Keine Zeitzusagen: Über Dauer und Ergebnis entscheidet die Zulassungsbehörde (siehe express.ts).

import type { FaqItem } from '../components/home/Faq.tsx';
import type { ServiceId } from './services.ts';

export interface ServiceLanding {
  path: string;
  /** <title> ohne Markenzusatz */
  title: string;
  description: string;
  label: string;
  h1: string;
  lead: string;
  intro: string[];
  services: ServiceId[];
  /** Voreingestellter Reiter im Schnellstart */
  quickMode: 'anmelden' | 'ummelden' | 'abmelden';
  /** Wunschkennzeichen-Seite: Regeln und Hinweise zur Kombination statt Leistungskarten zuerst */
  wish?: boolean;
  faq: FaqItem[];
}

export const SERVICE_LANDINGS: Record<'abmelden' | 'ummelden' | 'wunschkennzeichen', ServiceLanding> = {
  abmelden: {
    path: '/auto-abmelden',
    title: 'Auto online abmelden – Abmeldung beauftragen',
    description: 'Auto abmelden ohne Termin bei der Zulassungsstelle: Abmeldung online beauftragen, Unterlagen hochladen, Abmeldebestätigung erhalten.',
    label: 'Abmeldung',
    h1: 'Auto online abmelden',
    lead: 'Fahrzeug verkauft, verschrottet oder stillgelegt? Sie beauftragen die Abmeldung online, wir übernehmen den Gang zur Zulassungsbehörde.',
    intro: [
      'Bei der Abmeldung wird Ihr Fahrzeug außer Betrieb gesetzt. Die Zulassungsbehörde entstempelt die Kennzeichen und vermerkt die Außerbetriebsetzung in der Zulassungsbescheinigung Teil I. Versicherung und Kfz-Steuer werden anschließend automatisch informiert.',
      'Mit EasyKFZ24 brauchen Sie dafür keinen Termin: Sie geben Fahrzeug und Halter online an, laden Ausweis und Fahrzeugschein hoch und senden uns Vollmacht, Fahrzeugschein und beide Kennzeichenschilder per Post. Den Stand sehen Sie jederzeit in der Statusabfrage.',
    ],
    services: ['abmeldung'],
    quickMode: 'abmelden',
    faq: [
      {
        q: 'Kann ich mein Auto komplett online abmelden?',
        a: 'Den Auftrag erteilen Sie vollständig online. Für die Abmeldung selbst braucht die Zulassungsbehörde die Originale: die unterschriebene Vollmacht, die Zulassungsbescheinigung Teil I und beide Kennzeichenschilder. Diese senden Sie uns per Post.',
      },
      {
        q: 'Was passiert mit Versicherung und Kfz-Steuer?',
        a: 'Die Zulassungsbehörde meldet die Außerbetriebsetzung an Versicherung und Hauptzollamt. Die Kfz-Steuer endet mit dem Tag der Abmeldung; zu viel gezahlte Steuer erstattet das Hauptzollamt.',
      },
      {
        q: 'Kann ich das Kennzeichen nach der Abmeldung behalten?',
        a: 'Viele Zulassungsbehörden reservieren das Kennzeichen nach der Abmeldung für eine begrenzte Zeit. Ob und wie lange, regelt die jeweilige Behörde. Geben Sie den Wunsch im Auftrag als Hinweis an.',
      },
      {
        q: 'Was kostet die Abmeldung?',
        a: 'Sie zahlen unsere Servicepauschale; die amtliche Gebühr der Zulassungsbehörde kommt nach Beleg hinzu. Alle Beträge sehen Sie vor dem Absenden im Auftrag.',
      },
    ],
  },
  ummelden: {
    path: '/auto-ummelden',
    title: 'Auto ummelden online – Halterwechsel & Umzug',
    description: 'Fahrzeug ummelden ohne Wartenummer: Halterwechsel nach dem Autokauf oder neue Anschrift nach dem Umzug online beauftragen.',
    label: 'Ummeldung',
    h1: 'Auto ummelden – online beauftragen',
    lead: 'Gebrauchtwagen gekauft oder umgezogen? Wir schreiben das Fahrzeug auf Sie um oder tragen Ihre neue Anschrift ein.',
    intro: [
      'Nach dem Kauf eines zugelassenen Gebrauchtwagens muss das Fahrzeug auf den neuen Halter umgeschrieben werden. Nach einem Umzug ist die neue Anschrift in die Fahrzeugpapiere einzutragen. Beides ist eine Ummeldung bei der zuständigen Zulassungsbehörde.',
      'Bei einem Umzug innerhalb Deutschlands dürfen Sie Ihr bisheriges Kennzeichen behalten – auch wenn der neue Wohnort ein anderes Kürzel hat. Auf Wunsch reservieren wir stattdessen ein neues Wunschkennzeichen.',
    ],
    services: ['halterwechsel', 'umzug'],
    quickMode: 'ummelden',
    faq: [
      {
        q: 'Wann muss ich mein Auto ummelden?',
        a: 'Nach einem Halterwechsel und nach einem Umzug ist die Änderung unverzüglich bei der Zulassungsbehörde anzuzeigen. Beim Umzug zuerst die neue Anschrift beim Einwohnermeldeamt eintragen lassen – der Ausweis muss sie bereits enthalten.',
      },
      {
        q: 'Kann ich das Kennzeichen des Vorbesitzers übernehmen?',
        a: 'Das ist je nach Zulassungsbezirk und Zustimmung des Vorbesitzers möglich. Wählen Sie im Auftrag „Kennzeichen behalten“ und geben Sie das bisherige Kennzeichen an.',
      },
      {
        q: 'Brauche ich eine neue eVB-Nummer?',
        a: 'Beim Halterwechsel ja, denn der neue Halter braucht eine eigene Versicherung. Beim Umzug nur, wenn Sie ein neues Kennzeichen wählen.',
      },
      {
        q: 'Was kostet die Ummeldung?',
        a: 'Sie zahlen unsere Servicepauschale; die amtlichen Gebühren kommen nach Beleg hinzu. Wunschkennzeichen und Schilder sind optional. Alle Beträge sehen Sie vor dem Absenden im Auftrag.',
      },
    ],
  },
  wunschkennzeichen: {
    path: '/wunschkennzeichen',
    title: 'Wunschkennzeichen reservieren – online für ganz Deutschland',
    description: 'Wunschkennzeichen online reservieren: Kombination eintippen, Zulassung beauftragen, geprägte Schilder per DHL oder UPS erhalten.',
    label: 'Wunschkennzeichen',
    h1: 'Wunschkennzeichen reservieren',
    lead: 'Initialen, Geburtsjahr oder Glückszahl: Tippen Sie Ihre Kombination direkt ins Schild – wir reservieren sie bei der zuständigen Zulassungsbehörde, sofern sie frei ist.',
    intro: [
      'Das Ortskennzeichen vor dem Bindestrich ergibt sich aus Ihrem Wohnort bzw. dem Firmensitz. Frei wählbar ist, was danach kommt: ein oder zwei Buchstaben und eine Zahl mit bis zu vier Ziffern – insgesamt höchstens acht Zeichen.',
      'Ob eine Kombination frei ist, entscheidet die Zulassungsbehörde. Ist sie bereits vergeben, melden wir uns mit Alternativen. Ein Wunschkennzeichen können Sie bei der Neuzulassung, bei der Ummeldung und bei der Wiederzulassung wählen.',
      'Nicht jede Kombination ist erlaubt: Buchstabenfolgen wie HJ, KZ, NS, SA und SS werden bundesweit nicht zugeteilt, und die Zahl darf nicht mit einer 0 beginnen. Für Elektrofahrzeuge gibt es das E-Kennzeichen, für Oldtimer ab 30 Jahren das H-Kennzeichen.',
    ],
    services: ['neuzulassung', 'halterwechsel', 'umzug', 'wiederzulassung'],
    quickMode: 'anmelden',
    wish: true,
    faq: [
      {
        q: 'Was kostet ein Wunschkennzeichen?',
        a: 'Für die Reservierung berechnen wir eine Bearbeitungspauschale; die amtliche Reservierungsgebühr der Zulassungsbehörde kommt nach Beleg hinzu. Geprägte Schilder können Sie optional mitbestellen.',
      },
      {
        q: 'Kann ich jedes Ortskennzeichen wählen?',
        a: 'Nein. Das Kürzel richtet sich nach dem Zulassungsbezirk Ihres Wohnorts. Wo die Kennzeichenliberalisierung mehrere Kürzel erlaubt, können Sie zwischen diesen wählen – auf den Kennzeichenseiten von A bis Z sehen Sie, welche Kürzel zu welchem Bezirk gehören.',
      },
      {
        q: 'Was passiert, wenn meine Kombination vergeben ist?',
        a: 'Dann melden wir uns mit freien Alternativen. Erst nach Ihrer Zustimmung wird eine andere Kombination reserviert.',
      },
      {
        q: 'Bekomme ich die Schilder gleich mit?',
        a: 'Ja, auf Wunsch liefern wir geprägte Schilder passend zu Ihrem Fahrzeug per DHL oder UPS. Sie können auch eigene Schilder verwenden.',
      },
    ],
  },
};
