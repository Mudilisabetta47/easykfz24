import Link from 'next/link';
import { WORDMARK_PATHS, WORDMARK_STROKE, WORDMARK_WIDTH } from './logo-paths.generated.ts';

/**
 * Bildmarke „E-Pfeil“: ein E, dessen Mittelbalken als Pfeil nach vorn läuft (Quelle: scripts/brand/logo.py).
 * Eigene Konstruktion ohne Fremdschrift – identisch in Website, OS, Favicon und Logodateien.
 */
export function LogoMark({ className = 'logo__mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
      <rect width="100" height="100" rx="24" fill="#2a55ff" />
      <g transform="translate(-3,0)" fill="none" stroke="#fff" strokeWidth="10" strokeLinejoin="round">
        <path d="M58,27 H28 V73 H58" strokeLinecap="butt" />
        <path d="M28,50 H76" strokeLinecap="butt" />
        <path d="M67,40.5 L77,50 L67,59.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Wortmarke „EASYKFZ24“ als Pfade; Farben über --logo-ink (EASY) und --logo-accent (KFZ24) */
export function Wordmark({ className = 'logo__word', id = 'wm' }: { className?: string; id?: string }) {
  return (
    <svg className={className} viewBox={`0 0 ${WORDMARK_WIDTH} 100`} aria-hidden="true">
      <clipPath id={`${id}-clip`}>
        <rect x="-20" y="0" width={WORDMARK_WIDTH + 40} height="100" />
      </clipPath>
      <g clipPath={`url(#${id}-clip)`} fill="none" strokeWidth={WORDMARK_STROKE} strokeLinejoin="round">
        {WORDMARK_PATHS.map((p, i) => (
          <path
            key={i}
            d={p.d}
            transform={`translate(${p.x},0)`}
            strokeLinecap={p.cap}
            stroke={p.part === 'easy' ? 'var(--logo-ink, currentColor)' : 'var(--logo-accent, #2a55ff)'}
          />
        ))}
      </g>
    </svg>
  );
}

export function Logo({ href = '/', id = 'logo' }: { href?: string; id?: string }) {
  return (
    <Link href={href} className="logo" aria-label="EasyKFZ24 – zur Startseite">
      <LogoMark />
      <Wordmark id={id} />
    </Link>
  );
}
