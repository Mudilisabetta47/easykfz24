import { DISPLAY, type DisplayStatus } from '../../lib/kfz-status.ts';

/** Bearbeitungsstand laut kfz-api.de; ohne Meldung „Auftrag eingegangen“ bzw. „–“. */
export function KfzBadge({ display, empty = '–' }: { display: string; empty?: string }) {
  if (!display || !(display in DISPLAY)) return <span className="muted">{empty}</span>;
  const d = DISPLAY[display as DisplayStatus];
  return <span className={`badge badge--${d.tone}`}>{d.label}</span>;
}
