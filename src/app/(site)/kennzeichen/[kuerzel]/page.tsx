import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import '../../../../styles/info.css';
import '../../../../styles/seo.css';
import { GermanLicensePlate } from '../../../../components/GermanLicensePlate.tsx';
import { Faq } from '../../../../components/home/Faq.tsx';
import { HeroQuickStart } from '../../../../components/home/HeroQuickStart.tsx';
import { Check } from '../../../../components/icons.tsx';
import { PromoBadge, promoActive } from '../../../../components/Promo.tsx';
import { districtCopy } from '../../../../lib/district-copy.ts';
import { allCodes, codeFromSlug, districtLabel, districtPage, joinGerman, slugForCode } from '../../../../lib/district-pages.ts';
import { publicBaseUrl } from '../../../../server/payments.ts';

type Params = Promise<{ kuerzel: string }>;

// Unbekannte Schreibweisen (z. B. /kennzeichen/OHZ oder /kennzeichen/WÜ) werden auf die kanonische Adresse umgeleitet.
export const dynamicParams = true;

export function generateStaticParams() {
  return allCodes().map((c) => ({ kuerzel: slugForCode(c) }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const code = codeFromSlug((await params).kuerzel);
  const page = code ? districtPage(code) : null;
  if (!page) return {};
  const copy = districtCopy(page);
  const url = `/kennzeichen/${page.slug}`;
  return {
    title: { absolute: `${copy.title} | EasyKFZ24` },
    description: copy.metaDescription,
    alternates: { canonical: url },
    openGraph: { title: copy.title, description: copy.metaDescription, url, type: 'website', locale: 'de_DE' },
  };
}

function CodeLinks({ codes, current }: { codes: string[]; current?: string }) {
  return (
    <ul className="code-links" role="list">
      {codes.map((c) => (
        <li key={c}>
          <Link href={`/kennzeichen/${slugForCode(c)}`} aria-current={c === current ? 'page' : undefined}>
            {c}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function KennzeichenOrtPage({ params }: { params: Params }) {
  const { kuerzel } = await params;
  const code = codeFromSlug(kuerzel);
  const page = code ? districtPage(code) : null;
  if (!page) notFound();
  if (kuerzel !== page.slug) permanentRedirect(`/kennzeichen/${page.slug}`);
  const copy = districtCopy(page);
  const label = districtLabel(page.district);
  const base = publicBaseUrl();

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Start', item: `${base}/` },
        { '@type': 'ListItem', position: 2, name: 'Kennzeichen', item: `${base}/kennzeichen` },
        { '@type': 'ListItem', position: 3, name: `Kennzeichen ${page.code}`, item: `${base}/kennzeichen/${page.slug}` },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: copy.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      <header className="page-head seo-head">
        <div className="shell seo-head__grid">
          <div className="seo-head__copy">
            <nav className="crumbs" aria-label="Brotkrumen">
              <ol>
                <li>
                  <Link href="/">Start</Link>
                </li>
                <li>
                  <Link href="/kennzeichen">Kennzeichen</Link>
                </li>
                <li aria-current="page">Kennzeichen {page.code}</li>
              </ol>
            </nav>
            <h1>Kennzeichen {page.code}</h1>
            <p className="seo-head__where">
              {label} · {joinGerman(page.states)}
            </p>
            <p className="lead">{copy.lead}</p>
            <ul className="ticks seo-head__ticks" role="list">
              <li>
                <Check width={18} height={18} /> Wunschkennzeichen direkt ins Schild tippen
              </li>
              <li>
                <Check width={18} height={18} /> Zulassung, Ummeldung und Abmeldung online beauftragen
              </li>
              <li>
                <Check width={18} height={18} /> Papiere und Schilder per DHL oder UPS – oder abholen
              </li>
            </ul>
            {promoActive() ? (
              <p className="seo-head__promo">
                <PromoBadge /> auf die Servicepauschale deiner ersten Beauftragung
              </p>
            ) : null}
          </div>
          <div className="seo-head__quick">
            <HeroQuickStart initialCity={page.code} />
          </div>
        </div>
      </header>

      <section className="shell section-pad seo-text" aria-labelledby="so-gehts">
        <h2 id="so-gehts" className="info-h2">
          {copy.howTitle}
        </h2>
        <p className="seo-text__p">{copy.howIntro}</p>
        <ol className="info-steps seo-steps" role="list">
          {copy.steps.map((s, i) => (
            <li key={s.t}>
              <span className="info-steps__n">0{i + 1}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="info-band">
        <div className="shell section-pad seo-split" aria-labelledby="bedeutung">
          <div className="seo-text">
            <h2 id="bedeutung" className="info-h2">
              {copy.meaningTitle}
            </h2>
            {copy.meaning.map((t) => (
              <p key={t} className="seo-text__p">
                {t}
              </p>
            ))}
          </div>
          <aside className="card seo-facts" aria-label={`Steckbrief ${page.code}`}>
            <GermanLicensePlate id={`seo-${page.slug}`} cityCode={page.code} letters="AB" numbers="123" size="100%" detail="lite" />
            <table>
              <tbody>
                <tr>
                  <th scope="row">Kürzel</th>
                  <td>{page.code}</td>
                </tr>
                {page.origin ? (
                  <tr>
                    <th scope="row">Abgeleitet von</th>
                    <td>{page.origin}</td>
                  </tr>
                ) : null}
                <tr>
                  <th scope="row">Zulassungsbezirk</th>
                  <td>{label}</td>
                </tr>
                <tr>
                  <th scope="row">Bundesland</th>
                  <td>{joinGerman(page.states)}</td>
                </tr>
              </tbody>
            </table>
          </aside>
        </div>
      </section>

      <section className="shell section-pad seo-text" aria-labelledby="wunsch">
        <h2 id="wunsch" className="info-h2">
          {copy.wishTitle}
        </h2>
        {copy.wish.map((t) => (
          <p key={t} className="seo-text__p">
            {t}
          </p>
        ))}
        <p>
          <Link href={`/kfz-anmelden/auftrag?leistung=neuzulassung`} className="btn">
            Jetzt Zulassung starten
          </Link>
        </p>
      </section>

      <section className="info-band">
        <div className="shell section-pad seo-text" aria-labelledby="kosten">
          <h2 id="kosten" className="info-h2">
            {copy.costTitle}
          </h2>
          <p className="seo-text__p">{copy.costIntro}</p>
          <div className="card info-prices seo-prices">
            <table>
              <tbody>
                {copy.costRows.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{r.label}</th>
                    <td>{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="info-prices__note">{copy.costNote}</p>
          </div>
        </div>
      </section>

      <section className="shell section-pad" aria-labelledby="weitere">
        {page.sameDistrict.length ? (
          <>
            <h2 id="weitere" className="info-h2">
              Weitere Kennzeichen für {label}
            </h2>
            <CodeLinks codes={page.sameDistrict} />
          </>
        ) : null}
        <h2 id={page.sameDistrict.length ? undefined : 'weitere'} className="info-h2">
          Weitere Kennzeichen mit {page.code[0]}
        </h2>
        <CodeLinks codes={page.sameLetter} />
        {page.sameState.length ? (
          <>
            <h2 className="info-h2">Kennzeichen in {joinGerman(page.states)}</h2>
            <CodeLinks codes={page.sameState} />
          </>
        ) : null}
        <p className="seo-all">
          <Link href="/kennzeichen">Alle Kennzeichen von A bis Z</Link>
        </p>
      </section>

      <section className="info-band">
        <div className="shell section-pad info-faq" aria-labelledby="faq-ort">
          <h2 id="faq-ort" className="info-h2">
            Häufige Fragen zum Kennzeichen {page.code}
          </h2>
          <Faq items={copy.faq} />
        </div>
      </section>
    </>
  );
}
