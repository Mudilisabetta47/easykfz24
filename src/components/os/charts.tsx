'use client';

// Diagramme für EasyKFZ24 OS – reines SVG, ohne Bibliothek.
// Regeln: Balken ≤ 24 px, 4 px abgerundetes Datenende, eckig an der Grundlinie; 2 px Lücke zwischen Balken;
// Haarlinien-Gitter; Tooltip beim Überfahren (Trefferfläche = ganze Spalte); Legende ab zwei Reihen;
// nie zwei Y-Achsen; Text in Textfarben, nie in Reihenfarbe; Tabellenansicht als Alternative.

import { useEffect, useId, useRef, useState } from 'react';

export interface Series {
  key: string;
  label: string;
  /** CSS-Variable der Reihenfarbe, z. B. var(--viz-1) */
  color: string;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Säule mit abgerundetem Datenende (oben) und eckiger Grundlinie. */
function colPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
}

export function ColumnChart<T extends Record<string, number | string>>({
  data,
  xKey,
  series,
  format,
  xLabel,
  height = 200,
  title,
}: {
  data: T[];
  xKey: keyof T;
  series: Series[];
  format: (v: number) => string;
  xLabel: (v: string) => string;
  height?: number;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const uid = useId();
  // Echte Breite messen statt zu strecken – sonst würden Beschriftungen verzerrt.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const H = height;
  const pad = { l: 52, r: 8, t: 10, b: 26 };
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))));
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / Math.max(data.length, 1);
  const gap = 2;
  const barW = Math.min(24, Math.max(2, (slot * 0.72 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(W / 70)));

  if (table) {
    return (
      <div className="os-chart">
        <div className="os-chart__bar">
          {series.length > 1 ? <Legend series={series} /> : <span />}
          <button type="button" className="os-linkbtn" onClick={() => setTable(false)}>
            Diagramm
          </button>
        </div>
        <div className="os-tablewrap">
          <table className="os-table os-table--compact">
            <thead>
              <tr>
                <th scope="col">Zeitraum</th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="num">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={i}>
                  <th scope="row">{xLabel(String(d[xKey]))}</th>
                  {series.map((s) => (
                    <td key={s.key} className="num">
                      {format(Number(d[s.key]) || 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="os-chart">
      <div className="os-chart__bar">
        {series.length > 1 ? <Legend series={series} /> : <span />}
        <button type="button" className="os-linkbtn" onClick={() => setTable(true)}>
          Tabelle
        </button>
      </div>
      <div className="os-chart__plot" ref={box}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-labelledby={`${uid}-t`} onPointerLeave={() => setHover(null)}>
          <title id={`${uid}-t`}>{title}</title>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="os-chart__grid" />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="os-chart__tick">
                {format(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = pad.l + i * slot + (slot - groupW) / 2;
            return (
              <g key={i}>
                {hover === i ? <rect x={pad.l + i * slot} y={pad.t} width={slot} height={plotH} className="os-chart__hover" /> : null}
                {series.map((s, k) => {
                  const v = Number(d[s.key]) || 0;
                  return <path key={s.key} d={colPath(x0 + k * (barW + gap), y(v), barW, pad.t + plotH - y(v))} fill={s.color} />;
                })}
                {i % labelEvery === 0 ? (
                  <text x={pad.l + i * slot + slot / 2} y={H - 8} textAnchor="middle" className="os-chart__tick">
                    {xLabel(String(d[xKey]))}
                  </text>
                ) : null}
                <rect
                  x={pad.l + i * slot}
                  y={pad.t}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                />
              </g>
            );
          })}
          <line x1={pad.l} x2={W - pad.r} y1={pad.t + plotH} y2={pad.t + plotH} className="os-chart__axis" />
        </svg>
        {hover !== null && data[hover] ? (
          <div className="os-chart__tip" style={{ left: `${((pad.l + hover * slot + slot / 2) / W) * 100}%` }} role="status">
            <strong>{xLabel(String(data[hover][xKey]))}</strong>
            {series.map((s) => (
              <span key={s.key}>
                <i style={{ background: s.color }} aria-hidden="true" /> {s.label}: {format(Number(data[hover][s.key]) || 0)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="os-legend" role="list">
      {series.map((s) => (
        <li key={s.key}>
          <i style={{ background: s.color }} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Horizontale Balken (eine Reihe) mit Wert am Balkenende – z. B. Aufträge je Status. */
export function BarList({ items, format = (v) => String(v) }: { items: { label: string; value: number; onClick?: () => void }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="os-barlist" role="list">
      {items.map((i) => (
        <li key={i.label}>
          <button type="button" onClick={i.onClick} disabled={!i.onClick} title={`${i.label}: ${format(i.value)}`}>
            <span className="os-barlist__label">{i.label}</span>
            <span className="os-barlist__track">
              <span className="os-barlist__bar" style={{ width: `${(i.value / max) * 100}%` }} />
            </span>
            <span className="os-barlist__value">{format(i.value)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
