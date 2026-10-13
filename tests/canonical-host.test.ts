// Eine Adresse für Suchmaschinen: http:// und www. → https://easykfz24.de (Pfad und Query bleiben erhalten).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalRedirect } from '../src/lib/canonical-host.ts';

describe('Weiterleitung auf die Hauptdomain', () => {
  it('http und www werden dauerhaft umgeleitet', () => {
    assert.deepEqual(canonicalRedirect('http://easykfz24.de/kennzeichen/ohz?x=1'), { location: 'https://easykfz24.de/kennzeichen/ohz?x=1', status: 301 });
    assert.deepEqual(canonicalRedirect('https://www.easykfz24.de/'), { location: 'https://easykfz24.de/', status: 301 });
    assert.deepEqual(canonicalRedirect('http://WWW.easykfz24.de/status'), { location: 'https://easykfz24.de/status', status: 301 });
  });
  it('POST behält die Methode (308)', () => {
    assert.equal(canonicalRedirect('http://easykfz24.de/api/zahlung/webhook', 'POST')?.status, 308);
  });
  it('Hauptdomain über HTTPS und fremde Hosts bleiben unverändert', () => {
    assert.equal(canonicalRedirect('https://easykfz24.de/'), null);
    assert.equal(canonicalRedirect('http://127.0.0.1:8787/'), null);
    assert.equal(canonicalRedirect('https://easykfz24.mudilisa.workers.dev/'), null);
    assert.equal(canonicalRedirect('http://localhost:3000/kennzeichen'), null);
  });
});
