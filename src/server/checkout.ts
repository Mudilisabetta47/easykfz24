// Sicherheitsschalter für den verbindlichen Kunden-Checkout (Website-Bestellung).
// Im Produktivbetrieb nur offen, wenn BEIDES gilt:
//   1. BESTELLUNG_AKTIV=1 – vom Inhaber gesetzt, sobald Bestellablauf und Verbraucherinformationen rechtlich geprüft sind
//   2. die Widerrufsbelehrung und die elektronische Widerrufsfunktion sind erreichbar (WIDERRUF_AKTIV=1)
// Ohne Schalter nimmt die Website keine Aufträge an (Seite zeigt einen Hinweis, /api/auftrag antwortet 503).
// Statusabfrage, Zahlungslinks und Widerruf bestehender Aufträge bleiben unberührt. Lokal (Entwicklung) immer offen.

import { withdrawalMode } from './withdrawal.ts';

export type CheckoutState = { open: true } | { open: false; reason: 'widerruf' | 'freigabe' };

export function checkoutState(env: Record<string, string | undefined> = process.env): CheckoutState {
  if (env.NODE_ENV !== 'production') return { open: true };
  if (withdrawalMode() !== 'aktiv') return { open: false, reason: 'widerruf' };
  if (env.BESTELLUNG_AKTIV !== '1') return { open: false, reason: 'freigabe' };
  return { open: true };
}

export const CHECKOUT_CLOSED_MESSAGE =
  'Die Online-Beauftragung ist gerade noch nicht freigeschaltet. Bitte melden Sie sich bei uns – wir helfen Ihnen gern persönlich weiter.';
