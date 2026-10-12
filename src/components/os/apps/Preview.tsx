'use client';

// Dokumentvorschau: Bilder mit Zoom/Drehen, PDFs im integrierten Betrachter des Browsers (Seiten, Zoom, Suche).
// Die Datei kommt immer über die geschützte Route – nie über eine öffentliche Speicher-Adresse.

import { useState } from 'react';

export function Preview({ url, mime, name }: { url: string; mime: string; name: string }) {
  const [zoom, setZoom] = useState(1);
  const [rot, setRot] = useState(0);
  const image = mime.startsWith('image/') && mime !== 'image/heic';
  return (
    <figure className="os-preview">
      {image ? (
        <div className="os-preview__stage">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={name} style={{ transform: `scale(${zoom}) rotate(${rot}deg)` }} />
        </div>
      ) : mime === 'application/pdf' ? (
        <iframe src={`${url}#view=FitH`} title={name} />
      ) : (
        <div className="os-preview__none">Für dieses Format gibt es keine Vorschau – bitte herunterladen.</div>
      )}
      <figcaption>
        <span className="os-preview__name">{name}</span>
        {image ? (
          <span className="os-row os-row--tight">
            <button type="button" className="os-iconbtn" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))} aria-label="Verkleinern">
              −
            </button>
            <span className="os-small">{Math.round(zoom * 100)} %</span>
            <button type="button" className="os-iconbtn" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Vergrößern">
              +
            </button>
            <button type="button" className="os-iconbtn" onClick={() => setRot((r) => (r + 90) % 360)} aria-label="Drehen">
              ⟳
            </button>
          </span>
        ) : null}
        <a className="os-link" href={url} target="_blank" rel="noopener">
          Neuer Tab
        </a>
        <a className="os-link" href={`${url}${url.includes('?') ? '&' : '?'}download=1`}>
          Download
        </a>
      </figcaption>
    </figure>
  );
}
