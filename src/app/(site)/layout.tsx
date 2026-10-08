import type { ReactNode } from 'react';
import { MotionProvider } from '../../components/MotionProvider.tsx';
import { SiteFooter } from '../../components/SiteFooter.tsx';
import { SiteHeader } from '../../components/SiteHeader.tsx';

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#inhalt" className="skip-link">
        Zum Inhalt springen
      </a>
      <SiteHeader />
      <main id="inhalt">{children}</main>
      <SiteFooter />
      <MotionProvider />
    </>
  );
}
