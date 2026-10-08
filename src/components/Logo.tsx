import Link from 'next/link';

/** Bildmarke: ein „E“, dessen mittlerer Balken als Bewegungspfeil nach vorn läuft. */
export function LogoMark({ className = 'logo__mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 34 34" aria-hidden="true">
      <rect x="0.5" y="0.5" width="33" height="33" rx="9.5" fill="#0a1433" stroke="rgb(255 255 255 / 0.14)" />
      <rect x="9" y="8.6" width="3.4" height="16.8" rx="1.7" fill="#fff" />
      <rect x="9" y="8.6" width="15.4" height="3.4" rx="1.7" fill="#fff" />
      <rect x="9" y="22" width="15.4" height="3.4" rx="1.7" fill="#fff" />
      <path d="M10.7 15.3h12.6l-1.7-1.7a1 1 0 0 1 1.4-1.4l3.6 3.6a1.2 1.2 0 0 1 0 1.7l-3.6 3.6a1 1 0 0 1-1.4-1.4l1.7-1.7H10.7a1.35 1.35 0 0 1 0-2.7z" fill="#3d6bff" />
    </svg>
  );
}

export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="logo" aria-label="EasyKFZ24 – zur Startseite">
      <LogoMark />
      <span className="logo__word" aria-hidden="true">
        Easy<b>KFZ24</b>
      </span>
    </Link>
  );
}
