import type { Metadata } from 'next';
import '../../../styles/info.css';
import '../../../styles/seo.css';
import { HeroQuickStart } from '../../../components/home/HeroQuickStart.tsx';
import { CodeIndex, type CodeEntry } from '../../../components/seo/CodeIndex.tsx';
import { allCodes, districtLabel, districtPage, joinGerman } from '../../../lib/district-pages.ts';

export const metadata: Metadata = {
  title: { absolute: 'Kfz-Kennzeichen von A bis Z – alle Ortskennzeichen in Deutschland | EasyKFZ24' },
  description:
    'Alle deutschen Ortskennzeichen von A bis Z mit Zulassungsbezirk und Bundesland. Kürzel suchen, Wunschkennzeichen direkt eintippen und die Zulassung online beauftragen.',
  alternates: { canonical: '/kennzeichen' },
};

export default function KennzeichenIndexPage() {
  const entries: CodeEntry[] = allCodes().map((code) => {
    const p = districtPage(code)!;
    return { code, slug: p.slug, name: districtLabel(p.district), state: joinGerman(p.states) };
  });
  return (
    <>
      <header className="page-head seo-head">
        <div className="shell seo-head__grid">
          <div className="seo-head__copy">
            <p className="label">Kennzeichen</p>
            <h1>Kfz-Kennzeichen von A bis Z</h1>
            <p className="lead">
              Alle {entries.length} Ortskennzeichen für den allgemeinen Verkehr in Deutschland – mit Zulassungsbezirk und
              Bundesland. Such dein Kürzel, tipp dein Wunschkennzeichen direkt ins Schild und beauftrage die Zulassung online.
            </p>
          </div>
          <div className="seo-head__quick">
            <HeroQuickStart />
          </div>
        </div>
      </header>
      <section className="shell section-pad" aria-label="Alle Ortskennzeichen">
        <CodeIndex entries={entries} />
      </section>
      <section className="info-band">
        <div className="shell section-pad seo-text">
          <h2 className="info-h2">Wie ist ein deutsches Kennzeichen aufgebaut?</h2>
          <p className="seo-text__p">
            Ganz vorn steht das Unterscheidungszeichen mit ein bis drei Buchstaben – das Ortskennzeichen. Es richtet sich nach
            dem Zulassungsbezirk, in dem der Halter seinen Hauptwohnsitz oder seinen Firmensitz hat. Dahinter folgen die
            Plaketten der Zulassungsbehörde und die Erkennungsnummer aus ein oder zwei Buchstaben und bis zu vier Ziffern.
            Insgesamt hat ein Kennzeichen höchstens acht Zeichen.
          </p>
          <p className="seo-text__p">
            Viele Landkreise geben neben dem aktuellen Kürzel auch frühere Kürzel wieder aus, etwa nach Kreisreformen. Welche
            Kürzel für deinen Bezirk möglich sind, siehst du auf der jeweiligen Kennzeichen-Seite.
          </p>
        </div>
      </section>
    </>
  );
}
