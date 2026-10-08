// Verfügbarkeit von Wunschkennzeichen – Anbindungspunkt für einen externen Dienst.
//
// Es gibt keine bundesweite öffentliche Schnittstelle; jede Zulassungsbehörde führt ihre eigene Reservierung.
// Sobald EasyKFZ24 Zugang zu einem Dienst hat, der Verfügbarkeiten liefert, genügt es, in der .env
//   PLATE_AVAILABILITY_URL=https://…   (POST, JSON)
//   PLATE_AVAILABILITY_KEY=…           (optional, wird als Bearer-Token gesendet)
// zu setzen. Erwartetes Format:
//   Anfrage: { "plates": ["OHZ-AB 123", …] }
//   Antwort: { "results": { "OHZ-AB 123": "frei" | "vergeben" | "unbekannt", … } }
// Ohne Konfiguration ist jeder Status „unbekannt“ – die Website behauptet dann nie, ein Kennzeichen sei frei.

export type Availability = 'frei' | 'vergeben' | 'unbekannt';

export interface AvailabilityProvider {
  name: 'keiner' | 'extern';
  check(plates: string[]): Promise<Record<string, Availability>>;
}

const unknownFor = (plates: string[]) => Object.fromEntries(plates.map((p) => [p, 'unbekannt' as Availability]));

const noProvider: AvailabilityProvider = {
  name: 'keiner',
  async check(plates) {
    return unknownFor(plates);
  },
};

function httpProvider(url: string, key: string | undefined): AvailabilityProvider {
  return {
    name: 'extern',
    async check(plates) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify({ plates }),
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) return unknownFor(plates);
        const json = (await res.json()) as { results?: Record<string, string> };
        return Object.fromEntries(
          plates.map((p) => {
            const v = json.results?.[p];
            return [p, v === 'frei' || v === 'vergeben' ? v : 'unbekannt'];
          }),
        );
      } catch (e) {
        console.error('[kennzeichen] Verfügbarkeitsdienst nicht erreichbar', e);
        return unknownFor(plates);
      }
    },
  };
}

export function availabilityProvider(): AvailabilityProvider {
  const url = process.env.PLATE_AVAILABILITY_URL;
  return url ? httpProvider(url, process.env.PLATE_AVAILABILITY_KEY) : noProvider;
}
