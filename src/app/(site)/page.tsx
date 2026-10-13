import type { Metadata } from 'next';
import '../../styles/home.css';
import { Dealers } from '../../components/home/Dealers.tsx';
import { Documents } from '../../components/home/Documents.tsx';
import { Faq } from '../../components/home/Faq.tsx';
import { HOME_FAQ } from '../../components/home/faq-content.ts';
import { Finale } from '../../components/home/Finale.tsx';
import { Germany } from '../../components/home/Germany.tsx';
import { Hero } from '../../components/home/Hero.tsx';
import { HomeScenes } from '../../components/home/HomeScenes.tsx';
import { PlateSection } from '../../components/home/PlateSection.tsx';
import { Pricing } from '../../components/home/Pricing.tsx';
import { Process } from '../../components/home/Process.tsx';
import { Services } from '../../components/home/Services.tsx';
import { StatusDemo } from '../../components/home/StatusDemo.tsx';
import { Trust } from '../../components/home/Trust.tsx';
import { Split } from '../../components/Split.tsx';
import { getPlateOffer } from '../../server/plates.ts';
import { getExpressOffer } from '../../server/express.ts';
import { publicBaseUrl } from '../../server/payments.ts';
import { og } from '../../lib/seo.ts';
import { PROVIDER, PROVIDER_NAME } from '../../lib/site.ts';

// Schilderpreise kommen aus dem Finanzcenter – Seite daher je Aufruf (Preisangabe = berechneter Preis)
export const dynamic = 'force-dynamic';

const HOME_TITLE = 'Auto online anmelden, ummelden & abmelden | EasyKFZ24';
const HOME_DESCRIPTION =
  'Kfz-Zulassung online beauftragen: Auto anmelden, ummelden oder abmelden und Wunschkennzeichen reservieren – deutschlandweit, ohne Termin vor Ort.';

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: og(HOME_TITLE, HOME_DESCRIPTION, '/'),
};

function homeJsonLd() {
  const base = publicBaseUrl();
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${base}/#organization`,
      name: 'EasyKFZ24',
      legalName: PROVIDER_NAME,
      url: `${base}/`,
      logo: `${base}/logo/icon-512.png`,
      email: PROVIDER.email,
      ...(PROVIDER.phone ? { telephone: PROVIDER.phone } : {}),
      address: { '@type': 'PostalAddress', streetAddress: PROVIDER.street, postalCode: PROVIDER.zip, addressLocality: PROVIDER.city, addressCountry: 'DE' },
      areaServed: { '@type': 'Country', name: 'Deutschland' },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${base}/#website`,
      name: 'EasyKFZ24',
      url: `${base}/`,
      inLanguage: 'de-DE',
      publisher: { '@id': `${base}/#organization` },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: HOME_FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
  ];
}

export default async function HomePage() {
  const [plateOffer, expressOffer] = await Promise.all([getPlateOffer(), getExpressOffer()]);
  return (
    <>
      <Hero />
      <Services />
      <Process />
      <Documents />
      <StatusDemo />
      <PlateSection />
      <Germany />
      <Trust />
      <Dealers />
      <Pricing plateOffer={plateOffer} expressOffer={expressOffer} />
      <section className="faq-sec" id="faq" aria-labelledby="faq-title">
        <div className="shell faq-sec__grid">
          <div>
            <p className="label" data-reveal="fade">Hilfe</p>
            <Split id="faq-title" className="faq-sec__title" text="Häufige Fragen." />
            <p className="lead" data-reveal="up">
              Deine Frage ist nicht dabei? Im Vorgang kannst du jederzeit einen Hinweis an uns hinterlassen.
            </p>
          </div>
          <div data-reveal="up">
            <Faq items={HOME_FAQ} />
          </div>
        </div>
      </section>
      <Finale />
      <HomeScenes />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(homeJsonLd()).replace(/</g, '\\u003c') }} />
    </>
  );
}
