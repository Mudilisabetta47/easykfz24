// Schilderpreise (Standard, Carbon-Optik) aus dem Finanzcenter: gespeichert in settings ('plate_prices') als nummerierte
// Preisversionen. Jeder Auftrag speichert beim Anlegen seine Kosten (Einkauf, Versand Lieferant, Preisversion) – spätere
// Preisänderungen verändern historische Aufträge nicht. Ohne Eintrag gelten die Ausgangswerte (Version 0).

import { z } from 'zod';
import {
  offerOf,
  PLATE_FINISHES,
  PLATE_VERSION_DEFAULT,
  type PlateCostSnapshot,
  type PlateFinish,
  type PlateOffer,
  type PlatePriceVersion,
  type PlatePrices,
} from '../lib/plates.ts';
import { PRICE_CONFIG, type PriceConfig } from '../lib/pricing.config.ts';
import { withPlateOffer } from '../lib/pricing.ts';
import { getDb } from './db.ts';
import { setSettings } from './settings.ts';

export type { PlatePriceVersion };

const KEY = 'plate_prices';
const MAX_HISTORY = 200;

const cents = z.number().int().min(0).max(100_000);
const entry = z.object({ sellCents: cents.nullable(), buyCents: cents, active: z.boolean() });
const checksSchema = z.object({ deliverable: z.boolean(), permitted: z.boolean() });
const inputSchema = z
  .object({ prices: z.object({ standard: entry, carbon: entry }), supplierShippingCents: cents.nullable(), carbonChecks: checksSchema })
  .superRefine((v, ctx) => {
    const p = v.prices;
    if (p.standard.sellCents === null || !p.standard.active) ctx.addIssue({ code: 'custom', message: 'Standard braucht einen Verkaufspreis und bleibt im Angebot' });
    for (const f of PLATE_FINISHES) {
      if (p[f].active && !p[f].sellCents) ctx.addIssue({ code: 'custom', message: `Für ${f === 'carbon' ? 'Carbon-Optik' : 'Standard'} fehlt der Verkaufspreis` });
    }
    if (p.carbon.active && !(v.carbonChecks.deliverable && v.carbonChecks.permitted)) {
      ctx.addIssue({ code: 'custom', message: 'Carbon-Optik nur anbieten, wenn Lieferbarkeit beim Lieferanten und Zulässigkeit bestätigt sind' });
    }
  });

function valid(v: unknown): v is PlatePriceVersion {
  const x = v as PlatePriceVersion;
  return !!x && typeof x.from === 'string' && Number.isInteger(x.version) && inputSchema.safeParse({ prices: x.prices, supplierShippingCents: x.supplierShippingCents, carbonChecks: x.carbonChecks }).success;
}

/** Preisversionen, älteste zuerst. */
export async function platePriceHistory(): Promise<PlatePriceVersion[]> {
  const row = await (await getDb()).first<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY);
  if (!row?.value) return [];
  try {
    const list = JSON.parse(row.value) as unknown[];
    return Array.isArray(list) ? list.filter(valid) : [];
  } catch {
    return [];
  }
}

/** Gültige Preisversion zu einem Zeitpunkt; vor dem ersten Eintrag die Ausgangswerte (Version 0). */
export function versionAt(history: PlatePriceVersion[], at: string): PlatePriceVersion {
  let current = PLATE_VERSION_DEFAULT;
  for (const v of history) if (v.from <= at) current = v;
  return current;
}

export function pricesAt(history: PlatePriceVersion[], at: string): PlatePrices {
  return versionAt(history, at).prices;
}

export async function currentPlateVersion(): Promise<PlatePriceVersion> {
  const h = await platePriceHistory();
  return h.length ? h[h.length - 1] : PLATE_VERSION_DEFAULT;
}

export async function getPlatePrices(): Promise<PlatePrices> {
  return (await currentPlateVersion()).prices;
}

export async function getPlateOffer(): Promise<PlateOffer> {
  const v = await currentPlateVersion();
  return offerOf(v.prices, v.carbonChecks);
}

/** Preiskonfiguration für Website, Bestellung und Verwaltung – immer mit den aktuellen Schilderpreisen. */
export async function priceConfig(): Promise<PriceConfig> {
  return withPlateOffer(PRICE_CONFIG, await getPlateOffer());
}

/** Kosten der Schilder für einen neuen Auftrag (wird im Auftrag gespeichert). */
export function plateCostSnapshot(v: PlatePriceVersion, finish: PlateFinish, qty: number): PlateCostSnapshot {
  const unit = v.prices[finish].buyCents;
  return { finish, qty, unitBuyCents: unit, buyCents: unit * qty, supplierShippingCents: v.supplierShippingCents, priceVersion: v.version, priceFrom: v.from };
}

export async function savePlatePrices(input: unknown, by: string): Promise<{ ok: true; version: PlatePriceVersion } | { ok: false; error: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Ungültige Preise' };
  const history = await platePriceHistory();
  const version: PlatePriceVersion = {
    version: (history.at(-1)?.version ?? 0) + 1,
    from: new Date().toISOString(),
    by,
    prices: parsed.data.prices,
    supplierShippingCents: parsed.data.supplierShippingCents,
    carbonChecks: parsed.data.carbonChecks,
  };
  history.push(version);
  await setSettings({ [KEY]: JSON.stringify(history.slice(-MAX_HISTORY)) }, by);
  return { ok: true, version };
}
