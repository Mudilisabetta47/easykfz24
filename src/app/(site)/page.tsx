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

export const metadata: Metadata = {
  title: { absolute: 'EasyKFZ24 – Kfz-Zulassung. Einfach digital.' },
};

const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: HOME_FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
};

export default function HomePage() {
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
      <Pricing />
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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
    </>
  );
}
