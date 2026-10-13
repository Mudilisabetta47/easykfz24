import type { Metadata } from 'next';
import { ServiceLandingPage } from '../../../components/ServiceLandingPage.tsx';
import { og } from '../../../lib/seo.ts';
import { SERVICE_LANDINGS } from '../../../lib/service-landings.ts';

// Preise kommen aus der Konfiguration bzw. dem Finanzcenter – je Aufruf rendern
export const dynamic = 'force-dynamic';

const page = SERVICE_LANDINGS.ummelden;

export const metadata: Metadata = {
  title: page.title,
  description: page.description,
  alternates: { canonical: page.path },
  openGraph: og(page.title, page.description, page.path),
};

export default function Page() {
  return <ServiceLandingPage page={page} />;
}
