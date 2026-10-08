import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../../styles/forms.css';
import '../../styles/admin.css';

export const metadata: Metadata = {
  title: { default: 'Verwaltung', template: '%s · Verwaltung EasyKFZ24' },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <div className="admin">{children}</div>;
}
