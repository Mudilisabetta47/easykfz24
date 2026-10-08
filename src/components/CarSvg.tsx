/**
 * Fahrzeug in Seitenansicht (Coupé, ohne Markenzeichen), reines SVG.
 * Räder ([data-wheel]) und Lichtkante ([data-sweep]) werden von den Szenen bewegt.
 */
export function CarSvg({ id, className = '' }: { id: string; className?: string }) {
  const g = (name: string) => `${id}-${name}`;
  const url = (name: string) => `url(#${g(name)})`;
  const body =
    'M118 318C106 300 104 272 116 250C124 238 140 232 160 228C210 220 260 214 312 208C372 176 440 132 528 114C610 100 690 100 752 112C806 124 852 160 884 190C950 196 1022 204 1072 216C1094 222 1106 238 1108 258C1110 284 1104 306 1090 318L1012 322A84 84 0 0 0 846 322L374 322A84 84 0 0 0 206 322Z';
  const glass =
    'M336 210C392 176 452 140 532 126C612 113 690 114 742 124C790 134 830 162 856 192C700 196 500 204 336 210Z';

  const wheel = (cx: number, key: string) => (
    <g key={key}>
      <circle cx={cx} cy="330" r="80" fill="#02040c" />
      <g className="car__wheel" data-wheel>
        <circle cx={cx} cy="330" r="68" fill="#060a16" />
        <circle cx={cx} cy="330" r="64" fill="none" stroke="#1a2340" strokeWidth="2" />
        <circle cx={cx} cy="330" r="49" fill={url('rim')} />
        {Array.from({ length: 5 }, (_, i) => {
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          const x1 = cx + Math.cos(a) * 13;
          const y1 = 330 + Math.sin(a) * 13;
          const x2 = cx + Math.cos(a) * 45;
          const y2 = 330 + Math.sin(a) * 45;
          const off = 0.16;
          return (
            <g key={i} stroke="#d5ddf0" strokeLinecap="round">
              <path d={`M${x1} ${y1}L${cx + Math.cos(a - off) * 45} ${330 + Math.sin(a - off) * 45}`} strokeWidth="5" />
              <path d={`M${x1} ${y1}L${cx + Math.cos(a + off) * 45} ${330 + Math.sin(a + off) * 45}`} strokeWidth="5" />
              <path d={`M${x1} ${y1}L${x2} ${y2}`} strokeWidth="1" stroke="#7d8bb0" />
            </g>
          );
        })}
        <circle cx={cx} cy="330" r="12" fill="#121a33" stroke="#9fb0d8" strokeWidth="1.5" />
      </g>
      {/* Bremssattel – steht still, Markenakzent */}
      <path
        d={`M${cx - 30} ${330 - 22}A37 37 0 0 1 ${cx - 6} ${330 - 36}`}
        stroke="#3d6bff"
        strokeWidth="9"
        strokeLinecap="round"
        fill="none"
        opacity="0.9"
      />
    </g>
  );

  return (
    <svg className={`car ${className}`} viewBox="0 0 1200 420" aria-hidden="true">
      <defs>
        <linearGradient id={g('body')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a5d93" />
          <stop offset="0.28" stopColor="#24325e" />
          <stop offset="0.62" stopColor="#141d3d" />
          <stop offset="1" stopColor="#090f24" />
        </linearGradient>
        <linearGradient id={g('glass')} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#5d77b8" stopOpacity="0.85" />
          <stop offset="0.45" stopColor="#18244a" />
          <stop offset="1" stopColor="#070c1d" />
        </linearGradient>
        <radialGradient id={g('rim')} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#4b5878" />
          <stop offset="1" stopColor="#151c33" />
        </radialGradient>
        <linearGradient id={g('sweep')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#a9c1ff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#c8d7ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#a9c1ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={g('head')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#9fe9ff" />
          <stop offset="1" stopColor="#ffffff" />
        </linearGradient>
        <clipPath id={g('clip')}>
          <path d={body} />
        </clipPath>
        <filter id={g('soft')} x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
        <filter id={g('glow')} x="-50%" y="-200%" width="200%" height="500%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      <ellipse cx="612" cy="402" rx="540" ry="16" fill="#000" opacity="0.65" filter={url('soft')} />

      {wheel(290, 'r')}
      {wheel(930, 'f')}

      <path d={body} fill={url('body')} />
      <g clipPath={url('clip')}>
        <g data-sweep>
          <rect x="-320" y="80" width="300" height="260" fill={url('sweep')} transform="skewX(-18)" />
        </g>
      </g>
      {/* Schulterlinie und Kanten */}
      <path d="M160 228C210 220 260 214 312 208C372 176 440 132 528 114C610 100 690 100 752 112C806 124 852 160 884 190C950 196 1022 204 1072 216" fill="none" stroke="#a9bcf0" strokeOpacity="0.45" strokeWidth="2" />
      <path d="M168 248C420 232 800 224 1090 236" fill="none" stroke="#c9d6ff" strokeOpacity="0.22" strokeWidth="1.5" />
      <path d="M236 302C500 296 780 296 1000 302" fill="none" stroke="#000" strokeOpacity="0.35" strokeWidth="2" />

      <path d={glass} fill={url('glass')} />
      <path d={glass} fill="none" stroke="#c9d6ff" strokeOpacity="0.3" strokeWidth="1.5" />
      <path d="M640 117L657 117L648 197L631 198Z" fill="#0b1230" />

      <path d="M590 206C586 250 586 290 590 320" fill="none" stroke="#000" strokeOpacity="0.4" strokeWidth="1.4" />
      <path d="M842 196C848 236 850 280 846 318" fill="none" stroke="#000" strokeOpacity="0.4" strokeWidth="1.4" />
      <rect x="606" y="232" width="38" height="6" rx="3" fill="#c9d6ff" fillOpacity="0.28" />
      <path d="M846 192C852 180 872 178 882 186L880 197C868 199 856 199 846 197Z" fill="#141d3d" stroke="#a9bcf0" strokeOpacity="0.35" />

      {/* Licht */}
      <ellipse cx="1092" cy="238" rx="40" ry="10" fill="#9fe9ff" opacity="0.55" filter={url('glow')} />
      <path d="M1044 222C1070 226 1092 232 1103 242L1099 250C1082 244 1062 238 1038 234Z" fill={url('head')} />
      <path d="M116 252C128 244 146 238 168 234L170 242C150 246 132 252 120 258Z" fill="#ff4458" opacity="0.8" />
      <path d="M1036 292L1098 290L1092 306L1046 308Z" fill="#050916" />
    </svg>
  );
}
