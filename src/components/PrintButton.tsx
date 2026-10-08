'use client';

export function PrintButton({ label = 'Drucken' }: { label?: string }) {
  return (
    <button type="button" className="btn btn--sm" onClick={() => window.print()}>
      {label}
    </button>
  );
}
